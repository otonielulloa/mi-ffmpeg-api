const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Función auxiliar con FETCH NATIVO (Evita tener que instalar Axios en el servidor)
async function asegurarArchivo(input, targetPath) {
    if (!input) return false;
    
    // CORRECCIÓN PARA N8N: Si la imagen viene como objeto { imageUrl: '...' }, extraemos solo la URL
    if (typeof input === 'object' && input.imageUrl) {
        input = input.imageUrl;
    }
    
    if (typeof input !== 'string') {
        throw new Error('Formato de archivo inválido. Se esperaba un string o una propiedad imageUrl.');
    }

    if (input.startsWith('http://') || input.startsWith('https://')) {
        const response = await fetch(input);
        if (!response.ok) throw new Error(`Error al descargar URL (${response.status}): ${response.statusText}`);
        const arrayBuffer = await response.ok ? await response.arrayBuffer() : null;
        if (!arrayBuffer) throw new Error("No se pudieron obtener los bytes del archivo remoto.");
        fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
        return true;
    } else if (input.startsWith('data:') || input.length > 1000) {
        const base64Data = input.replace(/^data:.*?;base64,/, "");
        fs.writeFileSync(targetPath, base64Data, 'base64');
        return true;
    } else {
        if (fs.existsSync(input)) {
            fs.copyFileSync(input, targetPath);
            return true;
        } else {
            throw new Error(`Archivo no encontrado en el sistema local: ${input}`);
        }
    }
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
        // 1. Descargar Audio Principal
        await asegurarArchivo(audio, audioPath);

        // 2. Descargar Música de Fondo (Opcional)
        let tieneMusica = false;
        if (musica) {
            tieneMusica = await asegurarArchivo(musica, bgMusicPath);
            if (tieneMusica) archivosTemporales.push(bgMusicPath);
        }

        // 3. Descargar ráfaga de imágenes (Soporta mapeo directo de n8n)
        const rutasImagenes = [];
        for (let i = 0; i < imagenes.length; i++) {
            const imgPath = path.join(__dirname, `img-${timestamp}-${i}.jpg`);
            await asegurarArchivo(imagenes[i], imgPath);
            rutasImagenes.push(imgPath);
            archivosTemporales.push(imgPath);
        }

        // 4. LIMPIEZA Y CONVERSIÓN DE SUBTÍTULOS: WebVTT -> ASS (Estilo Shorts / TikTok)
        let cleanSubtitles = subtitles.replace(/\\"/g, '"').replace(/\r\n/g, '\n');
        
        let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,42,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,2,10,10,300,1
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

                // Traducir colores dinámicos HTML hexadecimales (#RRGGBB) al formato BGR de FFmpeg ({\c&HBBGGRR&})
                text = text.replace(/<font\s+color="([^"]+)">([\s\S]*?)<\/font>/gi, (m, color, content) => {
                    let assColor = '00FFFF'; // Amarillo por defecto si falla algo
                    const hex = color.replace('#', '');
                    if (hex.length === 6) {
                        const r = hex.substring(0, 2);
                        const g = hex.substring(2, 4);
                        const b = hex.substring(4, 6);
                        assColor = `${b}${g}${r}`; // Formato BGR invertido
                    }
                    return `{\\c&H${assColor}&}${content}{\\c&HFFFFFF&}`;
                });

                // Quitar cualquier residuo de etiquetas HTML HTML
                text = text.replace(/<[^>]*>/g, '');

                assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
            }
        });

        fs.writeFileSync(assPath, assContent, 'utf-8');

        // 5. CONSTRUCCIÓN DEL COMANDO FFMPEG (Auto-ajuste vertical 9:16)
        const duracionPorImagen = 3.5; 
        let inputs = '';
        let filterComplex = '';
        
        rutasImagenes.forEach((img, idx) => {
            inputs += ` -loop 1 -t ${duracionPorImagen} -i "${img}"`;
            filterComplex += `[${idx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${idx}];`;
        });

        const concatInputs = rutasImagenes.map((_, idx) => `[v${idx}]`).join('');
        filterComplex += `${concatInputs}concat=n=${rutasImagenes.length}:v=1:a=0[v_base];`;

        // Incrustar los subtítulos renderizados mediante la librería nativa de filtros libass
        const normalizedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        filterComplex += `[v_base]ass='${normalizedAssPath}'[v_final]`;

        inputs += ` -i "${audioPath}"`;
        let audioMapping = ` -map ${rutasImagenes.length}:a`;

        if (tieneMusica) {
            inputs += ` -i "${bgMusicPath}"`;
            filterComplex += `;[${rutasImagenes.length}:a]volume=1.0[a1];[${rutasImagenes.length + 1}:a]volume=0.15[a2];[a1][a2]amix=inputs=2:duration=first[a_final]`;
            audioMapping = ` -map "[a_final]"`;
        }

        const ffmpegCmd = `ffmpeg -y${inputs} -filter_complex "${filterComplex}" -map "[v_final]"${audioMapping} -c:v libx264 -pix_fmt yuv420p -shortest "${outputPath}"`;

        // 6. EJECUCIÓN
        exec(ffmpegCmd, (err, stdout, stderr) => {
            // Limpieza inmediata de archivos residuales
            archivosTemporales.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });

            if (err) {
                console.error('Error FFmpeg:', stderr);
                return res.status(500).json({ error: 'FFmpeg falló al procesar', detalles: stderr });
            }

            res.json({
                mensaje: 'Video renderizado exitosamente con subtítulos dinámicos',
                videoFile: outputName,
                path: outputPath
            });
        });

    } catch (error) {
        console.error('Error General:', error);
        archivosTemporales.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
        res.status(500).json({ error: 'Error interno en la API', detalles: error.message });
    }
});

app.use('/videos', express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor API operativo en el puerto ${PORT}`);
});
