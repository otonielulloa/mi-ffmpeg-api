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
            let inputSources = '';
            
            // 💡 MEJORA 1: Forzamos framerate de 30fps desde la entrada de la imagen para evitar parpadeos en el zoom
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

            // 💡 MEJORA 2: Aplicamos movimiento individual (Efecto Ken Burns) a cada imagen antes del concat
            imagenes.forEach((_, i) => {
                // Alternamos efectos: las escenas pares hacen Zoom In, las impares hacen Zoom Out
                let zoomExpression = (i % 2 === 0) ? "'1+0.0007*on'" : "'1.15-0.0007*on'";
                
                filterComplex += `[${i}:v]scale=1080x1920,zoompan=z=${zoomExpression}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920,fps=30[v${i}];`;
                concatInputs += `[v${i}]`;
            });

            // Concatemos los clips que ya tienen movimiento integrado ([v0], [v1], etc.)
            filterComplex += `${concatInputs}concat=n=${imagenes.length}:v=1:a=0[v_base];`;

            // AJUSTE DE TAMAÑO: Manteniendo tus subtítulos elegantes
            let videoOutLabel = 'v_base';
            if (fs.existsSync(srtPath)) {
                filterComplex += `[v_base]subtitles='${srtPath}':force_style='Fontname=DejaVuSans-Bold,Fontsize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=10,MarginV=350'[v_subbed];`;
                videoOutLabel = 'v_subbed';
            }

            if (tieneMusica) {
                filterComplex += `[${vozIndex}:a]volume=1.0[voice];[${musicaIndex}:a]volume=0.12[bg];[voice][bg]amix=inputs=2:duration=first[a_final];`;
            } else {
                filterComplex += `[${vozIndex}:a]volume=1.0[a_final];`;
            }

            if (filterComplex.endsWith(';')) {
                filterComplex = filterComplex.slice(0, -1);
            }

            // 💡 MEJORA 3: Aseguramos renders estables a 30fps nativos para TikTok
            const ffmpegCommand = `ffmpeg -y ${inputSources} -filter_complex "${filterComplex}" -map "[${videoOutLabel}]" -map "[a_final]" -c:v libx264 -pix_fmt yuv420p -r 30 -aspect 9:16 -shortest -crf 18 ${outputPath}`;

            console.log("Ejecutando Render con Efectos de Movimiento de IA Pro...");

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

app.listen(3000, () => console.log('Servidor FFmpeg Pro con Efectos Ken Burns Animados Activo'));
