const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '10mb' }));

// Slices automáticos de 4 palabras estilo TikTok
function segmentarGuion(texto) {
    const palabras = texto.replace(/\n/g, ' ').split(' ').filter(Boolean);
    let fragmentos = [];
    let grupoActual = [];

    palabras.forEach(palabra => {
        grupoActual.push(palabra);
        if (grupoActual.length >= 4 || palabra.includes('.') || palabra.includes('?') || palabra.includes('!')) {
            fragmentos.push(grupoActual.join(' '));
            grupoActual = [];
        }
    });
    if (grupoActual.length) fragmentos.push(grupoActual.join(' '));
    return fragmentos;
}

app.post('/render', (req, res) => {
    const { imagenes, audio, guion, musica } = req.body;
    
    if (!imagenes || !audio) {
        return res.status(400).json({ error: 'Faltan parámetros básicos (imagenes o audio)' });
    }

    const timestamp = Date.now();
    const outputName = `video-final-${timestamp}.mp4`;
    const outputPath = path.join(__dirname, outputName);
    const audioPath = path.join(__dirname, `audio-${timestamp}.mp3`);
    const bgMusicPath = path.join(__dirname, `bg-music-${timestamp}.mp3`);

    // 1. Descargar voz principal
    exec(`curl -o ${audioPath} "${audio}"`, (audioError) => {
        if (audioError) {
            console.error('Error descargando voz:', audioError);
            return res.status(500).send('Error descargando audio de voz');
        }

        let tieneMusica = !!musica;

        const procesarRender = () => {
            let inputSources = '';
            let totalDuration = 0;

            // Mapear imágenes secuenciales
            imagenes.forEach((img) => {
                inputSources += `-loop 1 -t ${img.duracion} -i "${img.imageUrl}" `;
                totalDuration += img.duracion;
            });

            // Mapear pista de Voz
            inputSources += `-i ${audioPath} `;
            const vozIndex = imagenes.length;

            // Mapear pista de Música de Fondo si existe
            let musicaIndex = null;
            if (tieneMusica) {
                inputSources += `-i ${bgMusicPath} `;
                musicaIndex = imagenes.length + 1;
            }

            // Construcción del Filtro Complejo
            let filterComplex = '';
            
            // Concatenar imágenes consecutivas
            filterComplex += `${imagenes.map((_, i) => `[${i}:v]`).join('')}concat=n=${imagenes.length}:v=1:a=0[v_base];`;

            // Mezclar audio: Voz al 100%, Música de fondo bajita al 12%
            if (tieneMusica) {
                filterComplex += `[${vozIndex}:a]volume=1.0[voice];[${musicaIndex}:a]volume=0.12[bg];[voice][bg]amix=inputs=2:duration=first[a_final];`;
            } else {
                filterComplex += `[${vozIndex}:a]volume=1.0[a_final];`;
            }

            // Capa de subtítulos dinámicos en Amarillo + Borde Negro
            let etiquetaVisualActual = 'v_base';
            if (guion) {
                const frases = segmentarGuion(guion);
                const totalCaracteres = frases.reduce((sum, f) => sum + f.length, 0);
                let tiempoAcumulado = 0;

                frases.forEach((frase, index) => {
                    const porcentaje = frase.length / totalCaracteres;
                    const duracionFrase = totalDuration * porcentaje;
                    const inicio = tiempoAcumulado;
                    const fin = inicio + duracionFrase;
                    tiempoAcumulado = fin;

                    const cleanFrase = frase
                        .replace(/'/g, "'\\\\''")
                        .replace(/:/g, '\\\\:')
                        .replace(/,/g, '\\\\,')
                        .toUpperCase();

                    const siguienteEtiqueta = `v_sub_${index}`;
                    
                    filterComplex += `[${etiquetaVisualActual}]drawtext=text='${cleanFrase}':fontcolor=yellow:fontsize=54:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:borderw=5:bordercolor=black:x=(w-text_w)/2:y=h-text_h-360:enable='between(t,${inicio.toFixed(2)},${fin.toFixed(2)})'[${siguienteEtiqueta}];`;
                    etiquetaVisualActual = siguienteEtiqueta;
                });
            }

            // Compilar todo en el archivo final
            const ffmpegCommand = `ffmpeg -y ${inputSources} -filter_complex "${filterComplex}" -map "[${etiquetaVisualActual}]" -map "[a_final]" -c:v libx264 -pix_fmt yuv420p -aspect 9:16 -shortest -crf 18 ${outputPath}`;

            console.log("Ejecutando Súper Render (Imágenes + Voz + Música + Subtítulos al estilo TikTok)...");

            exec(ffmpegCommand, (renderError, stdout, stderr) => {
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                if (fs.existsSync(bgMusicPath)) fs.unlinkSync(bgMusicPath);

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

app.listen(3000, () => console.log('Servidor FFmpeg Pro Multimedia listo en puerto 3000'));
