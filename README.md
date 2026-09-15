# Auto-Create-CS
Bot discord js yang berfungsi untuk membuat character story SA-MP secara otomatis tanpa terdeteksi oleh ai detector 
# Character Story Bot By Frenzz.luac

Bot Discord untuk membuat *character story* lewat form (modal), dengan gaya
penulisan prosa liris/puitis yang natural — bukan format laporan biodata.
Menggunakan **Groq API** (bukan OpenAI) karena free-tier-nya jauh lebih besar
dan tanpa kartu kredit.

## Fitur
- Slash command `/character` yang membuka form (modal) berisi:
  - Nama karakter
  - Tempat lahir
  - Tanggal lahir
  - Jumlah paragraf
  - Sifat/detail tambahan (opsional)
- Cerita di-generate lewat Groq API (model Llama/GPT-OSS/Qwen open-weight),
  dengan gaya naratif yang mengalir, penuh citraan, dan tidak template-y.
- Hasil ditampilkan dalam embed Discord.
- Tidak ada cooldown/rate-limit buatan di kode — batas yang ada murni dari
  kuota gratis Groq (lihat bagian "Soal Limit" di bawah).

## Soal "Unlimited/No Limit"

Penting untuk dipahami:
- **Tidak ada AI provider yang benar-benar tanpa batas.** Groq memberi
  free-tier dengan kuota permintaan yang cukup besar (jauh lebih longgar
  dari OpenAI free-tier), tapi tetap ada rate limit di level akun/organisasi.
- Kode bot ini **tidak menambahkan limit apa pun** dari sisi bot (tidak ada
  cooldown per user, tidak ada pembatasan harian). Jadi selama kuota Groq-mu
  belum habis, bot bisa dipakai sebebas mungkin.
- Kalau butuh kapasitas lebih besar lagi, upgrade ke Groq Developer tier
  (tanpa minimum spend, ~10x limit free-tier) atau tambahkan provider lain
  sebagai fallback (misalnya OpenRouter).

## Setup Lokal

1. Install dependency:
   ```bash
   npm install
   ```

2. Salin `.env.example` jadi `.env`, lalu isi:
   ```
   DISCORD_TOKEN=token_bot_discord_kamu
   CLIENT_ID=application_id_bot_kamu
   GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx
   ```

   - `DISCORD_TOKEN` & `CLIENT_ID` didapat dari https://discord.com/developers/applications
   - `GROQ_API_KEY` didapat gratis (tanpa kartu kredit) dari https://console.groq.com/keys
   - Pastikan bot punya scope `bot` dan `applications.commands` saat diundang ke server.

3. Jalankan bot:
   ```bash
   npm start
   ```

Saat pertama kali jalan, bot otomatis mendaftarkan slash command `/character`
secara global (bisa butuh beberapa menit sampai muncul di Discord).

## Deploy ke Railway

Project ini sudah menyertakan `Dockerfile`. Cara deploy:

1. Push project ini ke repo GitHub (jangan commit file `.env`!).
2. Di Railway, buat project baru → **Deploy from GitHub repo** → pilih repo ini.
   Railway otomatis mendeteksi `Dockerfile` dan build dari situ.
3. Di tab **Variables** pada service Railway, tambahkan:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GROQ_API_KEY`
   - `GROQ_MODEL` (opsional)
4. Deploy. Cek tab **Logs** — kalau muncul `Bot login sebagai ...` berarti
   bot sudah online.

Bot ini tidak membuka HTTP server (murni koneksi WebSocket ke Discord), jadi
tidak perlu setting domain/port apa pun di Railway. Kalau Railway meminta
health check HTTP, nonaktifkan health check di Settings → Deploy, atau
tambahkan server Express kecil (bisa saya bantu tambahkan kalau perlu).

## Build & Run via Docker manual (opsional, untuk tes lokal)

```bash
docker build -t character-bot .
docker run --env-file .env character-bot
```

## Catatan soal gaya tulisan

Prompt di `generateCharacterStory()` diarahkan supaya:
- Tidak berbentuk "Nama: ... / Lahir: ..." tapi menjalin data ke dalam narasi.
- Memakai variasi panjang kalimat dan majas secukupnya.
- Menghindari frasa klise yang sering muncul di tulisan AI generik.

Ini murni untuk membuat kualitas tulisan lebih sastrawi dan personal.
Bot ini **tidak** dirancang untuk mengelabui AI-content detector (mis. ZeroGPT,
GPTZero) — tulisan yang natural dan variatif memang cenderung lebih sulit
dibedakan dari tulisan manusia, tapi itu efek samping dari kualitas menulis
yang baik, bukan fitur "bypass detector". Gunakan hasil bot ini sesuai konteks
yang jujur (mis. worldbuilding, RP server, latihan menulis) — jangan untuk
menyamarkan tugas akademik sebagai karya asli.

## Kustomisasi
- Ganti model lewat env var `GROQ_MODEL` (lihat `.env.example` untuk opsi lain).
- Batas paragraf saat ini 1–10 (bisa diubah di `index.js`, fungsi `Math.min(10, ...)`).
- Bisa tambah opsi genre/tone (misal: melankolis, heroik, misteri) sebagai
  input modal tambahan.
  
