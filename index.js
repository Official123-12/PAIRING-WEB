import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

import qrRouter from './qr.js';
import pairRouter from './pair.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

// Increase event listeners
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Routes
app.use('/qr', qrRouter);
app.use('/code', pairRouter);
app.use('/pair', async (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});
app.use('/qrpage', (req, res) => {
    res.sendFile(path.join(__dirname, 'qr.html'));
});
app.use('/', async (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// Start server - LISTEN ON ALL INTERFACES (muhimu kwa Render)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ YouTube: @StanleyTechnology`);
    console.log(`✅ GitHub: @Stanytz378`);
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ http://localhost:${PORT}`);
});

export default app;