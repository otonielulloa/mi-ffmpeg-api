const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '10mb' }));

// Función para dividir el texto largo en varias líneas y que quepa en formato 9:16
function agruparTexto(texto, maxCaracteres = 30) {
    const palabras = texto.split(' ');
    let lineas = [];
    let lineaActual = '';

    palabras.forEach(palabra => {
        if ((lineaActual + palabra).length > maxCaracteres) {
            lineas.push(lineaActual.trim());
            lineaActual = palabra + ' ';
        } else {
            lineaActual += palabra + ' ';
        }
    });
    if (lineaActual) lineas.push(lineaActual.trim());
    return lineas.join('\n');
}

app.post('/render', (req, res) => {
    const { imagenes, audio, guion } = req.body;
    
    if (!imagenes || !audio || !guion) {
        return res.status(400).json({ error: 'Faltan parámetros (imagenes, audio o guion)' });
    }

    const timestamp = Date.now();
    const outputName = `video-final-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);
    const audioPath = path.join(__dirname, `audio-${timestamp}.mp3`);

    // 1. Descargar el archivo de audio localmente
    const commandToGetAudio = `curl -o ${audioPath} "${audio}"`;
    exec(commandToGetAudio, (audioError) => {
        if (audioError) {
            console.error('Error descargando audio:', audioError);
            return res.status(500).send('Error descargando audio');
        }

        // 2. Construir la ruta compleja de FFmpeg
        let filterComplex = '';
        let inputSources = '';
        let totalDuration = 0;

        imagenes.forEach((img, i) => {
            inputSources += `-loop 1 -t ${img.duracion} -i "${img.imageUrl}" `;
            const zoomFilter = `[${i}:v]scale=2000:2000,zoompan=z='min(zoom+0.001,1.1)':d=${img.duracion}*25:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920[v${i}];`;
            filterComplex += zoomFilter;
            totalDuration += img.duracion;
        });

        const concatFilter = imagenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${imagenes.length}:v=1:a=0[v_motion];`;
        filterComplex += concatFilter;

        // Formatear, saltar líneas y ESCAPAR caracteres especiales para FFmpeg (\:, \,)
        const textoFormateado = agruparTexto(guion.replace(/\n/g, ' '));
        const cleanGuion = textoFormateado
            .replace(/'/g, "'\\\\''") // Escapar comillas simples
            .replace(/:/g, '\\\\:')   // ¡ESTE ERA EL ERROR! Escapar dos puntos
            .replace(/,/g, '\\\\,');  // Escapar comas

        // Filtro drawtext con soporte de múltiples líneas
        filterComplex += `[v_motion]drawtext=text='${cleanGuion}':fontcolor=white:fontsize=48:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:box=1:boxcolor=black@0.6:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2+200:line_spacing=10:enable='lt(t,${totalDuration})'[v_subs]`;

        // 3. Ejecutar el comando final de FFmpeg
        const ffmpegCommand = `ffmpeg -y ${inputSources} -i ${audioPath} -filter_complex "${filterComplex}" -map "[v_subs]" -map ${imagenes.length}:a -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

        console.log(`Ejecutando render avanzado corregido`);

        exec(ffmpegCommand, (renderError, stdout, stderr) => {
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

            if (renderError) {
                console.error(stderr);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                return res.status(500).send(`Error en FFmpeg: ${stderr}`);
            }
            
            res.sendFile(outputPath, () => {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        });
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg Pro listo en puerto 3000'));
