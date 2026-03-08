import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors'; // 🔥 Muhimu: kuruhusu Vercel

import qrRouter from './qr.js';
import pairRouter from './pair.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

// 🔥 Orodha ya domain zinazoruhusiwa (Vercel + local)
const allowedOrigins = [
  'https://stanypairweb.vercel.app',    // Badilisha na domain yako halisi ya Vercel
  'http://localhost:8000',
  'http://localhost:3000',
  'https://pairing-web-su41.onrender.com' // Render yenyewe (hiari)
];

// 🔥 CORS middleware – hii inaruhusu Vercel kuongea na Render
app.use(cors({
  origin: function (origin, callback) {
    // Ruhusu requests zisizo na origin (kama mobile apps au Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('🚫 CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// 🔥 Handle preflight requests (OPTIONS) – muhimu kwa browsers
app.options('*', cors());

// Ikiwa unataka kuruhusu wote (si salama sana, lakini kwa haraka unaweza tumia hii)
// app.use(cors()); // Hii inaruhusu kila mtu – tumia kwa majaribio tu

// Bado unaweza kuongeza event emitter config
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Routers
app.use('/qr', qrRouter);
app.use('/code', pairRouter);

// Serve HTML files
app.use('/pair', async (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});
app.use('/qrpage', (req, res) => {
    res.sendFile(path.join(__dirname, 'qr.html'));
});
app.use('/', async (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// Error handling middleware (kukamata makosa)
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ YouTube: @StanleyTechnology`);
    console.log(`✅ GitHub: @Stanytz378`);
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`✅ CORS allowed origins:`, allowedOrigins);
});

export default app;