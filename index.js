const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());

app.post('/render', (req, res) => {
    const { imagenes, audio } = req.body;
    
    if (!imagenes || !audio) {
        return res.status(400).json({ error: 'Faltan los parámetros imagenes o audio' });
    }

    const timestamp = Date.now();
    const concatTxtPath = path.join(__dirname, `concat-${timestamp}.txt`);
    const outputName = `video-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);

    // 1. Crear el archivo txt para el concat de FFmpeg de forma segura
    let concatContent = '';
    imagenes.forEach((img) => {
        concatContent += `file '${img.imageUrl}'\nduration ${img.duracion}\n`;
    });
    
    fs.writeFileSync(concatTxtPath, concatContent);

    // 2. Construir el comando oficial de FFmpeg con whitelist para URLs externas
    const ffmpegCommand = `ffmpeg -y -f concat -safe 0 -protocol_whitelist file,http,https,tcp,tls -i ${concatTxtPath} -i "${audio}" -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest ${outputPath}`;

    console.log(`Ejecutando: ${ffmpegCommand}`);

    exec(ffmpegCommand, (error, stdout, stderr) => {
        // Borrar el archivo txt temporal de inmediato
        if (fs.existsSync(concatTxtPath)) fs.unlinkSync(concatTxtPath);

        if (error) {
            console.error(stderr);
            return res.status(500).send(`Error en FFmpeg: ${stderr}`);
        }
        
        // Enviar el video resultante de vuelta a n8n
        res.sendFile(outputPath, () => {
            // Borrar el video del servidor después de enviarlo
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg listo en puerto 3000'));
