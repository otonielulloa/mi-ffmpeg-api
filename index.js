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
    
    // Convertimos el formato VTT a SRT clásico para máxima compatibilidad con FFmpeg
    const srtFilename = `subtitles-${timestamp}.srt`;
    const srtContent = subtitles
        .replace(/^WEBVTT\s*/i, '')
        .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');

    try {
        fs.writeFileSync(srtFilename, srtContent, 'utf-8');
    } catch (err) {
        return res.status(500).send(`Error escribiendo SRT: ${err.message}`);
    }

    // Descargar audio de voz principal
    exec(`curl -L -o ${audioPath} "${audio}"`, (audioError) => {
        if (audioError) {
            console.error('Error descargando voz:', audioError);
            if (fs.existsSync(srtFilename)) fs.unlinkSync(srtFilename);
            return res.status(500).send('Error descargando audio de voz');
        }

        let tieneMusica = !!musica;

        const procesarRender = () => {
            let inputSources = '';
            imagenes.forEach((img) => {
                inputSources += `-loop 1 -t ${img.duracion} -i "${img.imageUrl}" `;
            });

            inputSources += `-i ${audioPath} `;
            const vozIndex = imagenes.length;

            let musicaIndex = null;
            if (tieneMusica) {
                inputSources += `-i ${bgMusicPath} `;
                musicaIndex = imagenes.length + 1;
            }

            let filterComplex = '';
            filterComplex += `${imagenes.map((_, i) => `[${i}:v]`).join('')}concat=n=${imagenes.length}:v=1:a=0[v_base];`;

            // 💡 AJUSTE DE ESTILO: Fontsize=20 (más pequeño) y MarginV=220 (lo sube más hacia el medio/centro)
            let videoOutLabel = 'v_base';
            if (fs.existsSync(srtFilename)) {
                filterComplex += `[v_base]subtitles=${srtFilename}:force_style='Fontname=DejaVuSans-Bold,Fontsize=20,PrimaryColour=&H00FFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=3,Alignment=2,MarginV=220'[v_subbed];`;
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

            const ffmpegCommand = `ffmpeg -y ${inputSources} -filter_complex "${filterComplex}" -map "[${videoOutLabel}]" -map "[a_final]" -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

            console.log("Ejecutando Súper Render con subtítulos optimizados...");

            exec(ffmpegCommand, (renderError, stdout, stderr) => {
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(bgMusicPath)) fs.unlinkSync(bgMusicPath);
                if (fs.existsSync(srtFilename)) fs.unlinkSync(srtFilename);

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

app.listen(3000, () => console.log('Servidor FFmpeg Pro con subtítulos centrados activo'));
