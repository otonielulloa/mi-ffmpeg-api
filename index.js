const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // Asegúrate de tenerlo en tu package.json para manejar URLs externas

const app = express();
app.use(express.json({ limit: '50mb' })); // Límite amplio por si envías imágenes pesadas

// Función auxiliar para descargar URLs o procesar archivos locales/base64 de forma segura
async function asegurarArchivo(input, targetPath) {
    if (!input) return false;
    if (input.startsWith('http://') || input.startsWith('https://')) {
        const response = await axios({ url: input, responseType: 'stream' });
        return new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(targetPath);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } else if (input.startsWith('data:') || input.length > 1000) {
        const base64Data = input.replace(/^data:.*?;base64,/, "");
        fs.writeFileSync(targetPath, base64Data, 'base64');
    } else {
        if (fs.existsSync(input)) {
            fs.copyFileSync(input, targetPath);
        } else {
            throw new Error(`Archivo no encontrado en el origen: ${input}`);
        }
    }
    return true;
}

app.post('/render', async (req, res) => {
    const { imagenes, audio, subtitles, musica } = req.body;

    if (!imagenes || !audio || !subtitles) {
        return res.status(400).json({ error: 'Faltan parámetros indispensables (imagenes, audio, subtitles)' });
    }

    const timestamp = Date.now();
    const outputName = `video-final-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);
    const audioPath = path.join(__dirname, `audio-${timestamp}.mp3`);
    const bgMusicPath = path.join(__dirname, `bg-music-${timestamp}.mp3`);
    const assPath = path.join(__dirname, `subtitles-${timestamp}.ass`);

    const archivosTemporales = [audioPath, assPath];

    try {
        // 1. Procesar Audio Principal Voces
        await asegurarArchivo(audio, audioPath);

        // 2. Procesar Música de Fondo (opcional)
        let tieneMusica = false;
        if (musica) {
            tieneMusica = await asegurarArchivo(musica, bgMusicPath);
            if (tieneMusica) archivosTemporales.push(bgMusicPath);
        }

        // 3. Procesar las Imágenes de la ráfaga
        const rutasImagenes = [];
        for (let i = 0; i < imagenes.length; i++) {
            const imgPath = path.join(__dirname, `img-${timestamp}-${i}.jpg`);
            await asegurarArchivo(imagenes[i], imgPath);
            rutasImagenes.push(imgPath);
            archivosTemporales.push(imgPath);
        }

        // 4. CIRUGÍA DE SUBTÍTULOS: Conversión WebVTT -> ASS (Soporta colores dinámicos por palabra)
        let cleanSubtitles = subtitles.replace(/\\"/g, '"').replace(/\r\n/g, '\n');
        
        // Estilo preconfigurado tipo Shorts/TikTok (Resolución vertical 1080x1920 con letras centradas abajo)
        let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,2,10,10,250,1
`;

        assContent += `\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

        const blocks = cleanSubtitles.split(/\n\s*\n/);
        blocks.forEach(block => {
            const lines = block.trim().split('\n');
            if (lines.length < 2) return;

            const timeLineIndex = lines.findIndex(l => l.includes('-->'));
            if (timeLineIndex === -1) return;

            const timeLine = lines[timeLineIndex];
            const textLines = lines.slice(timeLineIndex + 1);
            let text = textLines.join(' ');

            const match = timeLine.match(/(\d{2}:\d{2}:\d{2})[.,](\d{2,3})\s*-->\s*(\d{2}:\d{2}:\d{2})[.,](\d{2,3})/);
            if (match) {
                let start = match[1] + '.' + match[2].substring(0, 2);
                let end = match[3] + '.' + match[4].substring(0, 2);
                
                if (start.startsWith('0')) start = start.substring(1);
                if (end.startsWith('0')) end = end.substring(1);

                // Traducir etiquetas <font color="#RRGGBB"> al formato BGR exigido por ASS: {\c&HBBGGRR&}
                text = text.replace(/<font\s+color="([^"]+)">([\s\S]*?)<\/font>/gi, (m, color, content) => {
                    let assColor = '00FFFF'; // Color amarillo por defecto ante fallos
                    const hex = color.replace('#', '');
                    if (hex.length === 6) {
                        const r = hex.substring(0, 2);
                        const g = hex.substring(2, 4);
                        const b = hex.substring(4, 6);
                        assColor = `${b}${g}${r}`; // Inversión a BGR
                    }
                    return `{\\c&H${assColor}&}${content}{\\c&HFFFFFF&}`;
                });

                // Eliminar cualquier etiqueta residual extraña para mantener limpio el filtro
                text = text.replace(/<[^>]*>/g, '');

                assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
            }
        });

        fs.writeFileSync(assPath, assContent, 'utf-8');

        // 5. ENSAMBLAJE DINÁMICO DEL COMANDO FFMPEG
        const duracionPorImagen = 3.5; // Ajusta los segundos que dura cada diapositiva en pantalla
        let inputs = '';
        let filterComplex = '';
        
        // Configurar loops y reescalado vertical automático para las imágenes
        rutasImagenes.forEach((img, idx) => {
            inputs += ` -loop 1 -t ${duracionPorImagen} -i "${img}"`;
            filterComplex += `[${idx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${idx}];`;
        });

        // Concatenar secuencias de video de las diapositivas
        const concatInputs = rutasImagenes.map((_, idx) => `[v${idx}]`).join('');
        filterComplex += `${concatInputs}concat=n=${rutasImagenes.length}:v=1:a=0[v_base];`;

        // Incrustar los subtítulos .ass generados dinámicamente usando rutas normalizadas
        const normalizedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        filterComplex += `[v_base]ass='${normalizedAssPath}'[v_final]`;

        // Añadir canal de audio principal
        inputs += ` -i "${audioPath}"`;
        let audioMapping = ` -map ${rutasImagenes.length}:a`;

        // Mezclar con música de fondo reduciendo su volumen al 15% para que no opaque la voz
        if (tieneMusica) {
            inputs += ` -i "${bgMusicPath}"`;
            filterComplex += `;[${rutasImagenes.length}:a]volume=1.0[a1];[${rutasImagenes.length + 1}:a]volume=0.15[a2];[a1][a2]amix=inputs=2:duration=first[a_final]`;
            audioMapping = ` -map "[a_final]"`;
        }

        const ffmpegCmd = `ffmpeg -y${inputs} -filter_complex "${filterComplex}" -map "[v_final]"${audioMapping} -c:v libx264 -pix_fmt yuv420p -shortest "${outputPath}"`;

        // 6. EJECUCIÓN DEL PROCESADO
        exec(ffmpegCmd, (err, stdout, stderr) => {
            // Eliminar archivos del sistema temporal para no saturar el almacenamiento del servidor
            archivosTemporales.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });

            if (err) {
                console.error('Error Crítico FFmpeg:', stderr);
                return res.status(500).json({ error: 'Fallo al procesar video en FFmpeg', detalles: stderr });
            }

            res.json({
                mensaje: 'Video renderizado exitosamente con subtítulos dinámicos',
                videoFile: outputName,
                path: outputPath
            });
        });

    } catch (error) {
        console.error('Error General de Ejecución:', error);
        archivosTemporales.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
        res.status(500).json({ error: 'Error interno de renderizado', detalles: error.message });
    }
});

app.use('/videos', express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor API FFmpeg operativo en el puerto ${PORT}`);
});
