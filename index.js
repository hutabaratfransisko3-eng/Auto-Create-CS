const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require('discord.js');
const OpenAI = require('openai');
require('dotenv').config();

// Groq menyediakan endpoint yang kompatibel dengan format OpenAI SDK,
// jadi cukup ganti baseURL + pakai GROQ_API_KEY. Free-tier Groq jauh lebih
// besar dibanding OpenAI, meski tetap ada rate limit dari sisi Groq sendiri
// (bukan sesuatu yang bisa dihilangkan dari kode bot ini).
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ================== SLASH COMMAND DEFINITION ==================
const commands = [
  new SlashCommandBuilder()
    .setName('buatcs')
    .setDescription('Buat character story dengan form input'),
].map((cmd) => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash command berhasil didaftarkan.');
  } catch (err) {
    console.error('Gagal mendaftarkan command:', err);
  }
}

// ================== EVENT: READY ==================
client.once('clientReady', () => {
  console.log(`Bot login sebagai ${client.user.tag}`);
  registerCommands();
});

// ================== EVENT: INTERACTION ==================
client.on('interactionCreate', async (interaction) => {
  // --- Saat user pakai /character, tampilkan modal ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'character') {
    const modal = new ModalBuilder()
      .setCustomId('characterModal')
      .setTitle('Buat Character Story');

    const nameInput = new TextInputBuilder()
      .setCustomId('charName')
      .setLabel('Nama Karakter')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Contoh: Jean Corleone')
      .setRequired(true);

    const placeInput = new TextInputBuilder()
      .setCustomId('charPlace')
      .setLabel('Tempat Lahir')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Contoh: Los Angeles')
      .setRequired(true);

    const dateInput = new TextInputBuilder()
      .setCustomId('charDate')
      .setLabel('Tanggal Lahir')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Contoh: 14 Februari 2001')
      .setRequired(true);

    const paragraphInput = new TextInputBuilder()
      .setCustomId('charParagraphs')
      .setLabel('Jumlah Paragraf (angka)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Contoh: 3')
      .setRequired(true);

    const notesInput = new TextInputBuilder()
      .setCustomId('charNotes')
      .setLabel('Latar Belakang & Masalah yang Dihadapi')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Contoh: anak sulung, pendiam. Sedang menghadapi bisnisnya yang mengalami penurunan profit besar-besaran')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(placeInput),
      new ActionRowBuilder().addComponents(dateInput),
      new ActionRowBuilder().addComponents(paragraphInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  }

  // --- Saat modal disubmit ---
  if (interaction.isModalSubmit() && interaction.customId === 'characterModal') {
    await interaction.deferReply();

    const name = interaction.fields.getTextInputValue('charName');
    const place = interaction.fields.getTextInputValue('charPlace');
    const date = interaction.fields.getTextInputValue('charDate');
    const paragraphsRaw = interaction.fields.getTextInputValue('charParagraphs');
    const notes = interaction.fields.getTextInputValue('charNotes') || '-';

    const paragraphs = Math.max(1, Math.min(10, parseInt(paragraphsRaw) || 3));

    try {
      const story = await generateCharacterStory({
        name,
        place,
        date,
        paragraphs,
        notes,
      });

      const embed = new EmbedBuilder()
        .setTitle(`📖 Kisah ${name}`)
        .setDescription(story.length > 4096 ? story.slice(0, 4090) + '...' : story)
        .addFields(
          { name: 'Tempat Lahir', value: place, inline: true },
          { name: 'Tanggal Lahir', value: date, inline: true },
          { name: 'Jumlah Paragraf', value: `${paragraphs}`, inline: true }
        )
        .setColor(0x8e7cc3)
        .setFooter({ text: 'Character Story Generator • Struktur Teks Biografi' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      const isRateLimit = err?.status === 429;
      await interaction.editReply(
        isRateLimit
          ? '⏳ Sedang banyak permintaan (rate limit dari provider AI). Coba lagi sebentar lagi.'
          : '⚠️ Terjadi kesalahan saat membuat cerita. Coba lagi nanti.'
      );
    }
  }
});

// ================== GENERATOR CERITA ==================
async function generateCharacterStory({ name, place, date, paragraphs, notes }) {
  const systemPrompt = `
Kamu adalah penulis character story untuk kebutuhan roleplay (IC/In-Character)
di server Discord. Tulisanmu WAJIB mengikuti STRUKTUR TEKS BIOGRAFI baku
Bahasa Indonesia, dengan tiga bagian berurutan:

1. ORIENTASI
   Bagian pengenalan tokoh: nama, tanggal lahir, tempat lahir, dan latar
   belakang keluarga/kehidupan awal tokoh disampaikan secara jelas dan
   eksplisit (BUKAN tersirat/ambigu). Contoh gaya kalimat: "Brad Alvaro
   lahir pada tanggal 1 Februari 2002 di Jepang. Ia merupakan anak dari
   seorang ibu berdarah American-African..."

2. PERISTIWA DAN MASALAH
   Bagian ini menceritakan konflik atau masalah yang dihadapi tokoh dalam
   hidupnya (karier, keluarga, batin, dsb) yang membuat cerita lebih hidup
   dan menarik. Masalah ini menjadi rintangan yang harus dilalui tokoh
   sebelum mencapai kebahagiaan di akhir cerita.

3. REORIENTASI
   Bagian penutup: menceritakan bagaimana tokoh berhasil melewati
   masalahnya dan mencapai kebahagiaan/pencapaian di akhir cerita.

Aturan sudut pandang:
- WAJIB menggunakan sudut pandang orang KETIGA. Gunakan kata ganti
  "ia", "dia", "beliau", "mereka", ATAU cukup ulangi NAMA KARAKTER-nya
  secara langsung. JANGAN PERNAH menggunakan sudut pandang orang pertama
  ("aku", "saya") atau orang kedua ("kamu", "anda").
- Bahasa Indonesia baku, jelas, dan mudah dipahami — bukan gaya puitis,
  bukan metafora berlebihan, bukan ambigu. Informasi harus tersampaikan
  gamblang, sesuai kaidah teks biografi.
- Jangan gunakan judul/heading seperti "Orientasi:", "Peristiwa dan
  Masalah:", "Reorientasi:" di dalam hasil akhir — tulis sebagai cerita
  yang mengalir dari satu paragraf ke paragraf lain, namun tetap
  mengikuti urutan ketiga bagian tersebut secara implisit dalam alur cerita.
- Sesuaikan proporsi ketiga bagian dengan jumlah paragraf yang diminta.
`.trim();

  const userPrompt = `
Tulis sebuah character story sepanjang ${paragraphs} paragraf mengikuti
struktur teks biografi (Orientasi, Peristiwa dan Masalah, Reorientasi)
dengan sudut pandang orang ketiga.

Nama karakter: ${name}
Tempat lahir: ${place}
Tanggal lahir: ${date}
Latar belakang & masalah yang dihadapi: ${notes}

Ketentuan:
- Paragraf awal (Orientasi): perkenalkan nama, tempat dan tanggal lahir,
  serta latar belakang karakter secara jelas dan eksplisit.
- Paragraf tengah (Peristiwa dan Masalah): kembangkan konflik/masalah yang
  disebutkan (jika latar belakang & masalah kosong, buat konflik yang masuk
  akal dan relevan dengan latar belakang karakter).
- Paragraf akhir (Reorientasi): ceritakan bagaimana karakter berhasil
  mengatasi masalahnya dan meraih kebahagiaan/pencapaian.
- Gunakan sudut pandang orang ketiga sepanjang cerita.
`.trim();

  const completion = await openai.chat.completions.create({
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 900,
  });

  return completion.choices[0].message.content.trim();
}

client.login(process.env.DISCORD_TOKEN);
