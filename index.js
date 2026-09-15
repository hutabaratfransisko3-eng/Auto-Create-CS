const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
  AttachmentBuilder,
  MessageFlags,
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

// Peta byte CP1252 (0x80-0x9F) yang berbeda dari Latin-1/ISO-8859-1.
// Dipakai untuk mendeteksi & membalik mojibake seperti mojibake untuk
// non-breaking space atau hyphen khusus yang muncul ketika teks UTF-8
// sempat di-decode salah sebagai CP1252 lalu di-encode ulang jadi UTF-8.
const CP1252_MAP = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};
const REVERSE_CP1252 = new Map(
  Object.entries(CP1252_MAP).map(([byte, cp]) => [cp, parseInt(byte)])
);

// Coba membalik satu potongan teks mojibake (rangkaian karakter yang
// seluruhnya berasal dari byte < 0x100 setelah dipetakan balik ke CP1252)
// menjadi UTF-8 yang benar. Mengembalikan null kalau tidak cocok pola ini,
// supaya teks normal tidak ikut dirusak.
function tryFixMojibakeChunk(chunk) {
  const bytes = [];
  for (const ch of chunk) {
    const cp = ch.codePointAt(0);
    if (REVERSE_CP1252.has(cp)) {
      bytes.push(REVERSE_CP1252.get(cp));
    } else if (cp < 0x100) {
      bytes.push(cp);
    } else {
      return null;
    }
  }
  try {
    const decoded = Buffer.from(bytes).toString('utf-8');
    if (decoded.includes('\uFFFD')) return null;
    return decoded;
  } catch (_) {
    return null;
  }
}

// Kumpulan karakter unicode yang menjadi hasil pemetaan CP1252 (mis. smart
// quotes, trademark, dsb) — dipakai untuk membangun regex deteksi mojibake.
const CP1252_TARGET_CHARS = Object.values(CP1252_MAP)
  .map((cp) => String.fromCodePoint(cp))
  .join('');
const MOJIBAKE_PATTERN = new RegExp(
  `[\u00c3\u00c2\u00e2][\\x80-\\xff${CP1252_TARGET_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]{1,3}`,
  'g'
);

// Perbaiki mojibake dengan mencari kandidat rangkaian karakter yang diawali
// "Ã"/"Â"/"â" (indikator umum UTF-8 salah decode) dan membalikkannya per
// potongan, bukan seluruh teks sekaligus, supaya bagian yang sudah benar
// tidak ikut terganggu.
function fixMojibake(text) {
  return text.replace(MOJIBAKE_PATTERN, (match) => {
    const fixed = tryFixMojibakeChunk(match);
    return fixed !== null ? fixed : match;
  });
}

// Discord membatasi placeholder TextInput maksimal 100 karakter.
// Helper ini mencegah bot crash diam-diam kalau placeholder diubah
// jadi kepanjangan di kemudian hari.
function safePlaceholder(text) {
  return text.length > 100 ? text.slice(0, 97) + '...' : text;
}

// Sanitasi akhir: perbaiki mojibake, lalu normalkan semua karakter
// typographic (smart quotes, dash khusus, dsb) ke karakter ASCII biasa
// supaya file .txt yang dihasilkan selalu bersih di aplikasi apa pun.
function sanitizeText(text) {
  let result = fixMojibake(text);

  const replacements = [
    [/[\u2018\u2019\u201a\u2032]/g, "'"],
    [/[\u201c\u201d\u201e\u2033]/g, '"'],
    [/[\u2013\u2014\u2011]/g, '-'],
    [/\u2026/g, '...'],
    [/[\u00a0\u202f]/g, ' '],
    [/[\u200b-\u200d\ufeff]/g, ''],
  ];
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

// ================== SLASH COMMAND DEFINITION ==================
const commands = [
  new SlashCommandBuilder()
    .setName('buatcs')
    .setDescription('Buat character story dengan form input'),
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Kirim panel Create Character Story ke sebuah channel (admin only)')
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel tujuan panel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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

// ================== HELPER: BUAT MODAL ==================
function buildCharacterModal() {
  const modal = new ModalBuilder()
    .setCustomId('characterModal')
    .setTitle('Buat Character Story');

  const nameInput = new TextInputBuilder()
    .setCustomId('charName')
    .setLabel('Nama Karakter')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(safePlaceholder('Contoh: Jean Corleone'))
    .setRequired(true);

  const placeInput = new TextInputBuilder()
    .setCustomId('charPlace')
    .setLabel('Tempat Lahir')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(safePlaceholder('Contoh: Los Santos'))
    .setRequired(true);

  const dateInput = new TextInputBuilder()
    .setCustomId('charDate')
    .setLabel('Tanggal Lahir')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(safePlaceholder('Contoh: 14 Februari 2001'))
    .setRequired(true);

  const paragraphInput = new TextInputBuilder()
    .setCustomId('charParagraphs')
    .setLabel('Jumlah Paragraf (angka)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(safePlaceholder('Contoh: 4'))
    .setRequired(true);

  const notesInput = new TextInputBuilder()
    .setCustomId('charNotes')
    .setLabel('Latar Belakang & Masalah yang Dihadapi')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(safePlaceholder('Contoh: anak sulung, pendiam. Bisnisnya mengalami penurunan profit'))
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(placeInput),
    new ActionRowBuilder().addComponents(dateInput),
    new ActionRowBuilder().addComponents(paragraphInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  return modal;
}

// ================== HELPER: BUAT PANEL (embed + tombol) ==================
function buildPanel() {
  const embed = new EmbedBuilder()
    .setTitle('📝 Character Story Generator')
    .setDescription(
      '**Tekan tombol di bawah untuk membuat Character Story kamu!**\n\n' +
        '> Isi form dengan data karakter IC kamu.\n' +
        '> AI akan otomatis membuat CS berdasarkan struktur teks biografi.\n' +
        '> Hasil dikirim dalam format `.txt` siap pakai.\n' +
        '> Balasan bersifat privat — hanya kamu yang bisa melihatnya.'
    )
    .addFields({
      name: '✅ Fitur',
      value:
        '• Anti detect zerogpt dan ai detector\n' +
        '• Cerita/story berbeda-beda\n' +
        '• Generate cepat, langsung jadi\n' +
        '• Format file `.txt` langsung pakai\n' +
        '• Hasil privat, channel tetap bersih',
    })
    .setColor(0x5865f2)
    .setFooter({ text: 'Character Story Generator' })
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId('openCharacterModal')
    .setLabel('Create CS')
    .setEmoji('📋')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  return { embeds: [embed], components: [row] };
}

// ================== EVENT: INTERACTION ==================
client.on('interactionCreate', async (interaction) => {
  // --- /buatcs: tampilkan modal langsung ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'buatcs') {
    await interaction.showModal(buildCharacterModal());
  }

  // --- /setchannel: kirim panel ke channel yang dipilih (admin only) ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'setchannel') {
    const targetChannel = interaction.options.getChannel('channel');

    if (!targetChannel?.isTextBased()) {
      await interaction.reply({
        content: '⚠️ Channel yang dipilih harus berupa text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await targetChannel.send(buildPanel());
      await interaction.reply({
        content: `✅ Panel Create Character Story berhasil dikirim ke <#${targetChannel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: '⚠️ Gagal mengirim panel. Pastikan bot punya izin mengirim pesan & embed di channel tersebut.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // --- Tombol "Create CS" di panel: buka modal yang sama ---
  if (interaction.isButton() && interaction.customId === 'openCharacterModal') {
    await interaction.showModal(buildCharacterModal());
  }

  // --- Saat modal disubmit ---
  if (interaction.isModalSubmit() && interaction.customId === 'characterModal') {
    // Ephemeral: hanya user yang bersangkutan yang bisa melihat balasan ini,
    // jadi chat server tetap bersih.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const name = interaction.fields.getTextInputValue('charName');
    const place = interaction.fields.getTextInputValue('charPlace');
    const date = interaction.fields.getTextInputValue('charDate');
    const paragraphsRaw = interaction.fields.getTextInputValue('charParagraphs');
    const notes = interaction.fields.getTextInputValue('charNotes') || '-';

    const paragraphs = Math.max(1, Math.min(10, parseInt(paragraphsRaw) || 3));

    try {
      const rawStory = await generateCharacterStory({
        name,
        place,
        date,
        paragraphs,
        notes,
      });
      const story = sanitizeText(rawStory);

      // Susun isi file .txt: judul + metadata singkat + isi cerita.
      const fileContent =
        `CHARACTER STORY - ${name}\n` +
        `Tempat Lahir : ${place}\n` +
        `Tanggal Lahir: ${date}\n` +
        `Jumlah Paragraf: ${paragraphs}\n` +
        `${'-'.repeat(40)}\n\n` +
        story;

      // Nama file aman (hilangkan karakter yang tidak valid di nama file)
      const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_') || 'character';
      const attachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf-8'), {
        name: `CS_${safeName}.txt`,
      });

      await interaction.editReply({
        content: `📄 Character story untuk **${name}** sudah jadi. Tinggal download file-nya di bawah ini (hanya kamu yang bisa lihat pesan ini).`,
        files: [attachment],
      });
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
di server Discord. Tulisanmu WAJIB mengikuti STRUKTUR TEKS BIOGRAFI, dengan
tiga bagian berurutan, namun ditulis dengan gaya PROSA NARATIF BERMAJAS
(bukan laporan datar, bukan pula puisi abstrak) — kira-kira 40% unsur
kiasan/majas, 60% tetap menyampaikan informasi secara jelas.

CONTOH GAYA YANG DIACU (ikuti nuansa ini, bukan disalin):
"01 Januari 2000, Los Santos menyambut kelahiran Gantenbainne Mosqueda
dengan cara yang sederhana. Tidak ada pertanda langit terbelah atau
sesuatu yang mengubah arah kota; hanya seorang anak yang kelak akan
mengenal jalanan lebih baik daripada cerita yang tertulis tentang
dirinya..."

Ciri gaya yang harus ditiru dari contoh tersebut:
- Tanggal dan tempat lahir tetap disebut EKSPLISIT di kalimat/paragraf
  pembuka, tapi dibungkus dalam kalimat bermajas (personifikasi kota,
  metafora ringan) — bukan format "Nama lahir pada tanggal X di Y" yang kaku.
- Pilih SATU ATAU DUA metafora/simbol utama (misal: kota, jalan, cahaya,
  bayangan, cuaca, waktu) lalu pakai simbol itu berulang sebagai benang
  merah cerita — jangan mengganti-ganti majas tiap kalimat tanpa pola.
- Masalah/konflik disampaikan dengan nuansa reflektif dan agak tersirat
  (pembaca paham ada perjuangan/kegagalan tanpa harus dijabarkan sangat
  rinci secara teknis), namun tetap cukup jelas agar pembaca tahu apa
  inti masalahnya.
- Ending (Reorientasi) TIDAK HARUS "happy ending" yang gamblang/eksplisit.
  Boleh berupa penerimaan diri, perjalanan yang berlanjut, atau ketenangan
  batin — closure yang halus, bukan pencapaian besar yang disebutkan
  gamblang seperti "sekarang ia sukses membuka 8 cabang bisnis".
- Variasi panjang kalimat: campurkan kalimat pendek yang menghentak dengan
  kalimat panjang yang mengalir.
- Hindari klise AI seperti "dalam dunia yang penuh warna", "sejak saat itu
  hidupnya berubah", "sebuah perjalanan yang tak terlupakan".

Struktur tetap tiga bagian (tanpa heading eksplisit di hasil akhir):
1. ORIENTASI — pengenalan tokoh: nama, tanggal & tempat lahir (eksplisit,
   dibungkus kalimat bermajas), sedikit latar belakang/masa kecil.
2. PERISTIWA DAN MASALAH — konflik yang dihadapi tokoh, disampaikan
   reflektif namun cukup jelas intinya.
3. REORIENTASI — bagaimana tokoh sampai pada titik sekarang; closure halus,
   tidak harus berupa kemenangan besar yang eksplisit.

Aturan sudut pandang:
- WAJIB sudut pandang orang KETIGA: "ia", "dia", "beliau", "mereka", atau
  ulangi NAMA KARAKTER langsung. JANGAN PERNAH orang pertama ("aku","saya")
  atau orang kedua ("kamu","anda").
- Jangan gunakan judul/heading seperti "Orientasi:" dsb di hasil akhir.
- Sesuaikan proporsi ketiga bagian dengan jumlah paragraf yang diminta.

Aturan karakter/typografi (PENTING):
- Gunakan HANYA tanda kutip lurus biasa (') dan (") — JANGAN gunakan smart
  quotes/curly quotes ('' "").
- Gunakan tanda hubung biasa (-) untuk jeda dalam kalimat — JANGAN gunakan
  en-dash (–) atau em-dash (—).
- Gunakan tiga titik biasa (...) — JANGAN gunakan karakter ellipsis tunggal (…).
- Hindari karakter unicode non-standar lainnya. Tulis murni dengan huruf,
  angka, dan tanda baca ASCII standar.
`.trim();

  const userPrompt = `
Tulis sebuah character story sepanjang ${paragraphs} paragraf, dengan gaya
prosa naratif bermajas seperti pada contoh acuan (±40% majas, 60% kejelasan
informasi), mengikuti struktur Orientasi - Peristiwa dan Masalah -
Reorientasi, sudut pandang orang ketiga.

Nama karakter: ${name}
Tempat lahir: ${place}
Tanggal lahir: ${date}
Latar belakang/Kisah/Pekerjaan: ${notes}

Ketentuan:
- Paragraf awal (Orientasi): sebutkan tanggal dan tempat lahir secara
  eksplisit namun dibungkus kalimat bermajas (personifikasi kota/tempat,
  metafora ringan), lalu masuk ke sedikit latar belakang karakter.
- Pilih satu-dua simbol/metafora utama yang relevan dengan latar belakang
  karakter (kota, jalan, cahaya, laut, waktu, dsb) dan pakai konsisten.
- Paragraf tengah (Peristiwa dan Masalah): kembangkan konflik yang
  disebutkan user (jika kosong, buat konflik yang relevan dengan latar
  belakangnya) secara reflektif namun jelas maksudnya.
- Paragraf akhir (Reorientasi): tutup dengan closure yang halus — boleh
  berupa penerimaan atau perjalanan yang masih berlanjut, tidak harus
  pencapaian besar yang disebut gamblang.
- Gunakan sudut pandang orang ketiga sepanjang cerita.
`.trim();

  const completion = await openai.chat.completions.create({
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.9,
    max_tokens: 1000,
  });

  return completion.choices[0].message.content.trim();
}

client.login(process.env.DISCORD_TOKEN);
