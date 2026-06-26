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
    const vttPath = path.join(__dirname, `subtitles-${timestamp}.vtt`);

    // 1. Limpiamos y guardamos los subtítulos WebVTT locales
    const cleanedSubtitles = subtitles
        .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '') // Emojis
        .replace(/[^\x00-\x7F]/g, "") // Caracteres no ASCII
        .replace(/[^A-Z0-9a-z\sñÑáéíóúÁÉÍÓÚüÜ,;.¡!¿?:\->]/g, ""); // Puntuación básica

    try {
        fs.writeFileSync(vttPath, cleanedSubtitles, 'utf-8');
    } catch (err) {
        return res.status(500).send(`Error escribiendo VTT: ${err.message}`);
    }

    // 2. Descargar audio de voz
    exec(`curl -L -o ${audioPath} "${audio}"`, (audioError) => {
        if (audioError) {
            console.error('Error descargando voz:', audioError);
            if (fs.existsSync(vttPath)) fs.unlinkSync(vttPath);
            return res.status(500).send('Error descargando audio de voz');
        }

        let tieneMusica = !!musica;

        const procesarRender = () => {
            let inputSources = '';
            
            // Mapear imágenes secuenciales
            imagenes.forEach((img) => {
                inputSources += `-loop 1 -t ${img.duracion} -i "${img.imageUrl}" `;
            });

            // Mapear pistas de audio
            inputSources += `-i ${audioPath} `;
            const vozIndex = imagenes.length;

            let musicaIndex = null;
            if (tieneMusica) {
                inputSources += `-i ${bgMusicPath} `;
                musicaIndex = imagenes.length + 1;
            }

            // Construcción del Filtro Complejo
            let filterComplex = '';
            
            // 1. Concatenar imágenes consecutivas (mismo comando que tenías)
            filterComplex += `${imagenes.map((_, i) => `[${i}:v]`).join('')}concat=n=${imagenes.length}:v=1:a=0[v_base];`;

            // 💡 CAPA DE SUBTÍTULOS DINÁMICOS estilo profesional TikTok
            // Estampa subtítulos nativos en Amarillo brillante + Borde Negro + Centrado Abajo
            let videoOutLabel = 'v_base';
            if (fs.existsSync(vttPath)) {
                filterComplex += `[v_base]subtitles='${vttPath}':force_style='Fontname=DejaVuSans-Bold,Fontsize=26,PrimaryColour=&H00FFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=3,Alignment=2'[v_subbed];`;
                videoOutLabel = 'v_subbed';
            }

            // 2. Mezcla de Audio: Voz clara y Música de fondo suave
            if (tieneMusica) {
                filterComplex += `[${vozIndex}:a]volume=1.0[voice];[${musicaIndex}:a]volume=0.12[bg];[voice][bg]amix=inputs=2:duration=first[a_final];`;
            } else {
                filterComplex += `[${vozIndex}:a]volume=1.0[a_final];`;
            }

            // Compilar todo en el archivo final con formato TikTok (9:16)
            const ffmpegCommand = `ffmpeg -y ${inputSources} -filter_complex "${filterComplex}" -map "[${videoOutLabel}]" -map "[a_final]" -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

            console.log("Ejecutando Súper Render (Imágenes + Voz + Música + Subtítulos al estilo TikTok)...");

            exec(ffmpegCommand, (renderError, stdout, stderr) => {
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(bgMusicPath)) fs.unlinkSync(bgMusicPath);
                if (fs.existsSync(vttPath)) fs.unlinkSync(vttPath);

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

        // Descargar música de fondo si se envió una URL
        if (tieneMusica) {
            exec(`curl -L -o ${bgMusicPath} "${musica}"`, (bgError) => {
                if (bgError) {
                    console.error('Error descargando música de fondo:', bgError);
                    tieneMusica = false; // Renderizar solo con voz si el enlace falla
                }
                procesarRender();
            });
        } else {
            procesarRender();
        }
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg Pro con limpieza de subtítulos listo en puerto 3000'));
