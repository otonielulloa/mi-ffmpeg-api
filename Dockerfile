FROM node:18-slim

# Forzar la instalación real de FFmpeg Y de fuentes tipográficas para los subtítulos
RUN apt-get update && apt-get install -y ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
