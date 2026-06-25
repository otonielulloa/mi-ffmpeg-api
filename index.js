const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/render', (req, res) => {
    const { imagenes, audio } = req.body;
    
    if (!imagenes || !audio) {
        return res.status(400).json({ error: 'Faltan parámetros (imagenes o audio)' });
    }

    const timestamp = Date.now();
    const outputName = `video-final-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);
    const audioPath = path.join(__dirname, `audio-${timestamp}.mp3`);

    // 1. Descargar el archivo de audio localmente para FFmpeg
    const commandToGetAudio = `curl -o ${audioPath} "${audio}"`;
    exec(commandToGetAudio, (audioError) => {
        if (audioError) {
            console.error('Error descargando audio:', audioError);
            return res.status(500).send('Error descargando audio');
        }

        // 2. Construir la lista de fuentes de imágenes de forma dinámica
        let inputSources = '';
        imagenes.forEach((img) => {
            inputSources += `-loop 1 -t ${img.duracion} -i "${img.imageUrl}" `;
        });

        // Comando Corregido: Agregamos [v] al final de concat para que el mapeo funcione perfectamente
        const ffmpegCommand = `ffmpeg -y ${inputSources} -i ${audioPath} -filter_complex "concat=n=${imagenes.length}:v=1:a=0[v]" -map "[v]" -map ${imagenes.length}:a -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

        console.log(`Ejecutando render limpio de imágenes secuenciales...`);

        exec(ffmpegCommand, (renderError, stdout, stderr) => {
            // Borrar audio temporal
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

            if (renderError) {
                console.error(stderr);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                return res.status(500).send(`Error en FFmpeg: ${stderr}`);
            }
            
            // Enviar el video final de vuelta y liberarlo del servidor
            res.sendFile(outputPath, () => {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        });
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg listo en puerto 3000'));
