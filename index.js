const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/render', (req, res) => {
    // Tomamos imagenes y audio, ignorando el guion ya que no usaremos subtítulos
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
            // Cada imagen se lee como loop y se le asigna su duración exacta
            inputSources += `-loop 1 -t ${img.duracion} -i "${img.imageUrl}" `;
        });

        // Comando final de FFmpeg: Concatenación simple de imágenes secuenciales con audio
        // Usamos -map y concat=n para unir las fuentes de video, y -map a para mapear el audio
        // Eliminamos drawtext y cualquier filter complex para que no dé errores
        const ffmpegCommand = `ffmpeg -y ${inputSources} -i ${audioPath} -filter_complex "concat=n=${imagenes.length}:v=1:a=0" -map "[v]" -map a -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

        console.log(`Ejecutando render simple y secuencial de imágenes: ${ffmpegCommand}`);

        exec(ffmpegCommand, (renderError, stdout, stderr) => {
            // Borrar audio temporal
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

            if (renderError) {
                console.error(stderr);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                return res.status(500).send(`Error en FFmpeg: ${stderr}`);
            }
            
            // Enviar el video final de vuelta y borrarlo del servidor
            res.sendFile(outputPath, () => {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        });
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg listo para imágenes secuenciales en puerto 3000'));
```http://googleusercontent.com/image_generation_content/286
