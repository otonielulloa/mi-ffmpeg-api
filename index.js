const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/render', (req, res) => {
    const { imagenes, audio, subtitles, musica } = req.body;
    
    if (!imagenes || !audio || !subtitles) {
        return res.status(400).json({ error: 'Faltan parámetros básicos' });
    }

    const timestamp = Date.now();
    const outputName = `video-final-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);
    const audioPath = path.join(__dirname, `audio-${timestamp}.mp3`);
    const bgMusicPath = path.join(__dirname, `bg-music-${timestamp}.mp3`);
    const srtPath = path.join(__dirname, `subtitles-${timestamp}.srt`);

    // Conversión limpia a SRT manteniendo etiquetas HTML de color intactas
    const blocks = subtitles.split(/\r?\n\r?\n/);
    let srtContent = '';
    let index = 1;

    blocks.forEach(block => {
        const trimmed = block.trim();
        if (!trimmed || trimmed.toUpperCase().includes('WEBVTT')) return;
        
        const formattedBlock = trimmed.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
        srtContent += `${index}\n${formattedBlock}\n\n`;
        index++;
    });

    try {
        fs.writeFileSync(srtPath, srtContent, 'utf-8');
    } catch (err) {
        return res.status(500).send(`Error escribiendo SRT: ${err.message}`);
    }

    exec(`curl -L -o ${audioPath} "${audio}"`, (audioError) => {
        if (audioError) {
            if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
            return res.status(500).send('Error descargando audio');
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

            // 💡 ESTILO SHORT VIRAL: Quitamos PrimaryColour fijo para permitir que el SRT decida qué palabra pintar de amarillo
            let videoOutLabel = 'v_base';
            if (fs.existsSync(srtPath)) {
                filterComplex += `[v_base]subtitles='${srtPath}':force_style='Fontname=DejaVuSans-Bold,Fontsize=18,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=2,MarginV=320'[v_subbed];`;
                videoOutLabel = 'v_subbed';
            }

            if (tieneMusica) {
                filterComplex += `[${vozIndex}:a]volume=1.0[voice];[${musicaIndex}:a]volume=0.12[bg];[voice][bg]amix=inputs=2:duration=first[a_final];`;
            } else {
                filterComplex += `[${vozIndex}:a]volume=1.0[a_final];`;
            }

            if (filterComplex.endsWith(';')) filterComplex = filterComplex.slice(0, -1);

            const ffmpegCommand = `ffmpeg -y ${inputSources} -filter_complex "${filterComplex}" -map "[${videoOutLabel}]" -map "[a_final]" -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

            exec(ffmpegCommand, (renderError, stdout, stderr) => {
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(bgMusicPath)) fs.unlinkSync(bgMusicPath);
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

                if (renderError) {
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    return res.status(500).send(`Error FFmpeg: ${stderr}`);
                }
                
                res.sendFile(outputPath, () => {
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });
            });
        };

        if (tieneMusica) {
            exec(`curl -L -o ${bgMusicPath} "${musica}"`, (bgError) => {
                if (bgError) tieneMusica = false;
                procesarRender();
            });
        } else {
            procesarRender();
        }
    });
});

app.listen(3000, () => console.log('FFmpeg Activo'));
