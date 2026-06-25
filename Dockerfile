FROM node:18-slim

# Forzar la instalación real y limpia de FFmpeg en el sistema operativo
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar las librerías de Node
COPY package.json ./
RUN npm install

# Copiar el resto del código (index.js)
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
