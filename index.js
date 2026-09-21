const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/render', (req, res) => {
    const { imagenes, audio, subtitles, musica } = req.body;
    
    if (!imagenes || !audio || !subtitles) {
        return res.status(400).json({ error: 'Faltan parámetros básicos (imagenes, audio o subtítulos)' });
    }

    const timestamp = Date.now();
    const outputName = `video-final-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);
    const audioPath = path.join(__dirname, `audio-${timestamp}.mp3`);
    const bgMusicPath = path.join(__dirname, `bg-music-${timestamp}.mp3`);
    const srtPath = path.join(__dirname, `subtitles-${timestamp}.srt`);

    // Convertir WebVTT a SRT Real estructurando los bloques con números (1, 2, 3...)
    const blocks = subtitles.split(/\r?\n\r?\n/);
    let srtContent = '';
    let index = 1;

    blocks.forEach(block => {
        const trimmed = block.trim();
        if (!trimmed || trimmed.toUpperCase().includes('WEBVTT')) return;
        
        // Formateamos los milisegundos sustituyendo el punto por la coma requerida en SRT
        const formattedBlock = trimmed.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
        srtContent += `${index}\n${formattedBlock}\n\n`;
        index++;
    });

    try {
        fs.writeFileSync(srtPath, srtContent, 'utf-8');
    } catch (err) {
        return res.status(500).send(`Error escribiendo SRT: ${err.message}`);
    }

    // Descargar audio de voz principal
    exec(`curl -L -o ${audioPath} "${audio}"`, (audioError) => {
        if (audioError) {
            console.error('Error descargando voz:', audioError);
            if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
            return res.status(500).send('Error descargando audio de voz');
        }

        let tieneMusica = !!musica;

        const procesarRender = () => {
            // 💡 SOLUCIÓN AQUÍ: Calculamos la duración total exacta sumando cada escena
            const duracionTotal = imagenes.reduce((sum, img) => sum + parseFloat(img.duracion), 0);
            
            let inputSources = '';
            
            // Forzamos framerate de 30fps desde la entrada de la imagen para evitar parpadeos en el zoom
            imagenes.forEach((img) => {
                inputSources += `-loop 1 -framerate 30 -t ${img.duracion} -i "${img.imageUrl}" `;
            });

            inputSources += `-i ${audioPath} `;
            const vozIndex = imagenes.length;

            let musicaIndex = null;
            if (tieneMusica) {
                inputSources += `-i ${bgMusicPath} `;
                musicaIndex = imagenes.length + 1;
            }

            let filterComplex = '';
            let concatInputs = '';

         // Aplicamos escalado, normalización de SAR y efecto Ken Burns a cada imagen
imagenes.forEach((_, i) => {
    // Alternamos efectos: las escenas pares hacen Zoom In, las impares hacen Zoom Out
    let zoomExpression = (i % 2 === 0) ? "'1+0.0007*on'" : "'1.15-0.0007*on'";
    
    // 1. Normalizamos la imagen a 1080x1920 manteniendo aspecto y recortando excesos (crop)
    // 2. Forzamos setsar=1 para evitar discrepancias de SAR (Sample Aspect Ratio)
    // 3. Aplicamos el zoompan y aseguramos los 30 fps
    filterComplex += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z=${zoomExpression}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920,fps=30[v${i}];`;
    concatInputs += `[v${i}]`;
});

            // Concatemos los clips que ya tienen movimiento integrado ([v0], [v1], etc.)
            filterComplex += `${concatInputs}concat=n=${imagenes.length}:v=1:a=0[v_base];`;

            // Ajuste de subtítulos elegantes
            let videoOutLabel = 'v_base';
            if (fs.existsSync(srtPath)) {
                filterComplex += `[v_base]subtitles='${srtPath}':force_style='Fontname=DejaVuSans-Bold,Fontsize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=10,MarginV=350'[v_subbed];`;
                videoOutLabel = 'v_subbed';
            }

            if (tieneMusica) {
                filterComplex += `[${vozIndex}:a]volume=1.0[voice];[${musicaIndex}:a]volume=0.20[bg];[voice][bg]amix=inputs=2:duration=first[a_final];`;
            } else {
                filterComplex += `[${vozIndex}:a]volume=1.0[a_final];`;
            }

            if (filterComplex.endsWith(';')) {
                filterComplex = filterComplex.slice(0, -1);
            }

          // 1. Calculamos el bitrate objetivo para que el video NUNCA supere ~18 MB
// (18 MB en bits = 18 * 8 * 1024 * 1024 = 150,994,944 bits)
const targetBits = 18 * 8 * 1024 * 1024;
const totalBitrateKbps = Math.floor((targetBits / duracionTotal) / 1000);
const videoBitrateKbps = Math.max(totalBitrateKbps - 128, 200); // Descontamos 128k del audio

// 2. Reemplazamos -crf 18 por -b:v ${videoBitrateKbps}k -maxrate ${videoBitrateKbps}k -bufsize ${videoBitrateKbps * 2}k
const ffmpegCommand = `ffmpeg -y ${inputSources} -filter_complex "${filterComplex}" -map "[${videoOutLabel}]" -map "[a_final]" -c:v libx264 -b:v ${videoBitrateKbps}k -maxrate ${videoBitrateKbps}k -bufsize ${videoBitrateKbps * 2}k -pix_fmt yuv420p -r 30 -aspect 9:16 -t ${duracionTotal} ${outputPath}`;
            console.log(`Ejecutando Render con tiempo límite estricto de ${duracionTotal} segundos...`);

            exec(ffmpegCommand, (renderError, stdout, stderr) => {
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(bgMusicPath)) fs.unlinkSync(bgMusicPath);
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

                if (renderError) {
                    console.error(stderr);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    return res.status(500).send(`Error en FFmpeg: ${stderr}`);
                }
                
                res.sendFile(outputPath, () => {
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });
            });
        };

        if (tieneMusica) {
            exec(`curl -L -o ${bgMusicPath} "${musica}"`, (bgError) => {
                if (bgError) {
                    console.error('Error descargando música de fondo:', bgError);
                    tieneMusica = false;
                }
                procesarRender();
            });
        } else {
            procesarRender();
        }
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg Pro con Control de Tiempo Absoluto Activo'));
