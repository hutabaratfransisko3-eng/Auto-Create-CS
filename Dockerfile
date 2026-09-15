# ---- Base image ----
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# ---- Install dependencies ----
# Copy hanya package.json dulu supaya layer cache npm install efisien
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ---- Copy source code ----
COPY . .

# Railway otomatis inject PORT, tapi bot Discord ini tidak buka HTTP server,
# jadi tidak perlu EXPOSE. Kalau nanti ditambah health-check endpoint,
# tambahkan EXPOSE <port> di sini.

# Jalankan bot
CMD ["node", "index.js"]