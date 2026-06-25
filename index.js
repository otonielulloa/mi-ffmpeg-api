const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '10mb' })); // Aumentar límite para guiones largos

app.post('/render', (req, res) => {
    const { imagenes, audio, guion } = req.body;
    
    if (!imagenes || !audio || !guion) {
        return res.status(400).json({ error: 'Faltan parámetros (imagenes, audio o guion)' });
    }

    const timestamp = Date.now();
    const outputName = `video-final-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);
    const audioPath = path.join(__dirname, `audio-${timestamp}.mp3`);

    // 1. Guardar el archivo de audio localmente de forma temporal
    const commandToGetAudio = `curl -o ${audioPath} "${audio}"`;
    exec(commandToGetAudio, (audioError) => {
        if (audioError) {
            console.error('Error descargando audio:', audioError);
            return res.status(500).send('Error descargando audio');
        }

        // 2. Construir la ruta compleja de FFmpeg para movimiento (Ken Burns) y subtítulos
        let filterComplex = '';
        let inputSources = '';
        let totalDuration = 0;

        imagenes.forEach((img, i) => {
            inputSources += `-loop 1 -t ${img.duracion} -i "${img.imageUrl}" `;
            
            // FILTRO KEN BURNS: Hace un zoom suave y un pequeño paneo
            const zoomFilter = `[${i}:v]scale=2000:2000,zoompan=z='min(zoom+0.001,1.1)':d=${img.duracion}*25:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920[v${i}];`;
            filterComplex += zoomFilter;
            totalDuration += img.duracion;
        });

        // Concatenar todos los clips con movimiento
        const concatFilter = imagenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${imagenes.length}:v=1:a=0[v_motion];`;
        filterComplex += concatFilter;

        // FILTRO DE SUBTÍTULOS: Superpone el texto con drawtext
        // Configuración: Fuente grande, centrada abajo, texto blanco con borde negro
        // Reemplazar saltos de línea por espacios en el guion para que FFmpeg no falle
        const cleanGuion = guion.replace(/\n/g, ' ').replace(/'/g, "'\\\\''"); // Escapar comillas simples
        filterComplex += `[v_motion]drawtext=text='${cleanGuion}':fontcolor=white:fontsize=64:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:box=1:boxcolor=black@0.5:boxborderw=20:x=(w-text_w)/2:y=h-text_h-200:enable='lt(t,${totalDuration})'[v_subs]`;

        // 3. Ejecutar el comando final de FFmpeg
        const ffmpegCommand = `ffmpeg -y ${inputSources} -i ${audioPath} -filter_complex "${filterComplex}" -map "[v_subs]" -map ${imagenes.length}:a -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

        console.log(`Ejecutando render avanzado: ${ffmpegCommand}`);

        exec(ffmpegCommand, (renderError, stdout, stderr) => {
            // Borrar audio temporal
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

            if (renderError) {
                console.error(stderr);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                return res.status(500).send(`Error en FFmpeg: ${stderr}`);
            }
            
            // Enviar el video final de vuelta
            res.sendFile(outputPath, () => {
                // Borrar el video del servidor después de enviarlo
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        });
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg Pro listo en puerto 3000'));
