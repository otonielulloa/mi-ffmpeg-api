const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());

app.post('/render', (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Falta el comando' });

    const outputName = `video-${Date.now()}.mp4`;
    const finalCommand = command.replace('output.mp4', outputName);

    console.log(`Ejecutando: ffmpeg ${finalCommand}`);

    exec(`ffmpeg ${finalCommand}`, (error, stdout, stderr) => {
        if (error) {
            console.error(stderr);
            return res.status(500).send(stderr);
        }

        const filePath = path.join(__dirname, outputName);

        res.sendFile(filePath, () => {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });
    });
});

app.listen(3000, () => console.log('Servidor FFmpeg listo en puerto 3000'));
