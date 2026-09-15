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
    .setName('character')
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
      .setPlaceholder('Contoh: Alina Ratri')
      .setRequired(true);

    const placeInput = new TextInputBuilder()
      .setCustomId('charPlace')
      .setLabel('Tempat Lahir')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Contoh: Yogyakarta')
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
      .setLabel('Sifat / Detail Tambahan (opsional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Contoh: pendiam, suka laut, kehilangan ayahnya')
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
        .setFooter({ text: 'Character Story Generator' });

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
Kamu adalah penulis sastra yang menulis narasi karakter dengan gaya bebas (prosa liris),
memadukan unsur naratif dan puitis. Tulisanmu mengalir, penuh citraan (imagery), metafora,
dan majas, namun tetap menyampaikan informasi biografis karakter secara tersirat (ambigu,
tidak gamblang/report-style). Hindari struktur seperti "Nama: ... Lahir: ..." — semua data
harus dijalin secara halus ke dalam narasi, seolah pembaca menemukan fakta itu di sela-sela
kalimat, bukan disodorkan langsung.

Gaya penulisan:
- Kalimat bervariasi: ada yang pendek dan menghentak, ada yang panjang dan mengalir.
- Gunakan majas (metafora, personifikasi, simile) secukupnya, jangan berlebihan.
- Hindari klise AI seperti "dalam dunia yang penuh warna" atau "sejak saat itu, hidupnya berubah".
- Jangan gunakan format daftar, judul, atau penomoran. Tulis sebagai prosa mengalir.
- Nada tulisan natural, seperti manusia bercerita, bukan seperti laporan atau ringkasan.
`.trim();

  const userPrompt = `
Tulis sebuah character story untuk karakter berikut, sepanjang ${paragraphs} paragraf.

Nama karakter: ${name}
Tempat lahir: ${place}
Tanggal lahir: ${date}
Detail/sifat tambahan: ${notes}

Jalin informasi tempat dan tanggal lahir itu ke dalam narasi secara halus dan tidak eksplisit
(misalnya lewat suasana, musim, atau kenangan tempat), bukan disebutkan sebagai fakta datar.
Cerita harus terasa personal dan menggugah, seperti potongan babak dari kehidupan karakter.
`.trim();

  const completion = await openai.chat.completions.create({
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.95,
    max_tokens: 900,
  });

  return completion.choices[0].message.content.trim();
}

client.login(process.env.DISCORD_TOKEN);
