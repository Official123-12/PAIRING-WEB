import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import QRCode from 'qrcode';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    delay,
    DisconnectReason
} from '@whiskeysockets/baileys';
import uploadToGist from './Gist.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 60000;

// 🔁 Badilisha raw URL ya picha yako hapa
const IMAGE_URL = 'https://raw.githubusercontent.com/stanytz378/stanyimagesservers/main/IMG_1424.jpeg';

async function removeFile(FilePath) {
    try {
        if (fs.existsSync(FilePath)) await fs.remove(FilePath);
        return true;
    } catch (e) {
        return false;
    }
}

router.get('/', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;
    await fs.ensureDir('./qr_sessions');

    let qrGenerated = false;
    let sessionCompleted = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;
    let isCleaningUp = false;

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;
        console.log(`🧹 Cleanup ${sessionId}: ${reason}`);
        
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {}
            currentSocket = null;
        }
        setTimeout(() => removeFile(dirs), 5000);
    }

    async function initiateSession() {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (sessionCompleted || isCleaningUp) return;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (!responseSent && !res.headersSent) {
                res.status(503).send({ error: 'Connection failed' });
            }
            return cleanup('max_reconnects');
        }

        await fs.ensureDir(dirs);
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                shouldSyncHistory: false,
            });

            const sock = currentSocket;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent || sessionCompleted || isCleaningUp) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.send({
                            qr: qrDataURL,
                            message: 'Scan QR code with WhatsApp',
                            instructions: ['Open WhatsApp → Settings → Linked Devices → Link a Device']
                        });
                        console.log('📱 QR sent to client');
                    }
                } catch (err) {
                    console.error('QR error:', err);
                    if (!responseSent && !res.headersSent) {
                        res.status(500).send({ error: 'QR generation failed' });
                    }
                    cleanup('qr_error');
                }
            };

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect, qr, isNewLogin } = update;

                if (qr && !qrGenerated && !sessionCompleted) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            console.log('📤 Uploading creds...');
                            const sessionId = await uploadToGist(credsFile, 'creds.json');

                            const userJid = sock.authState.creds?.me?.id 
                                ? jidNormalizedUser(sock.authState.creds.me.id) 
                                : null;

                            if (userJid) {
                                await sock.sendMessage(userJid, { text: sessionId });

                                try {
                                    const imgRes = await fetch(IMAGE_URL);
                                    if (imgRes.ok) {
                                        const imgBuffer = await imgRes.buffer();
                                        await sock.sendMessage(userJid, {
                                            image: imgBuffer,
                                            caption: `✅ *SESSION GENERATED*\n\n⭐ GitHub: https://github.com/Stanytz378/IAMLEGEND\n💭 Group: https://chat.whatsapp.com/J19JASXoaK0GVSoRvShr4Y\n📢 Channel: https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p\n🤖 STANY TZ`
                                        });
                                    }
                                } catch (imgErr) {
                                    console.log('Image send failed');
                                }
                            }
                        }
                    } catch (err) {
                        console.error('Send error:', err);
                    } finally {
                        cleanup('complete');
                    }
                }

                if (isNewLogin) console.log('🔐 New login via QR');

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) return cleanup('already_complete');
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) {
                            res.status(401).send({ error: 'Invalid session' });
                        }
                        return cleanup('logged_out');
                    } else if (qrGenerated && !sessionCompleted) {
                        reconnectAttempts++;
                        console.log(`🔄 Reconnect ${reconnectAttempts}`);
                        if (currentSocket) {
                            try {
                                currentSocket.ev.removeAllListeners();
                                await currentSocket.end();
                            } catch (e) {}
                            currentSocket = null;
                        }
                        await delay(2000);
                        return initiateSession();
                    } else {
                        cleanup('closed');
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);
            timeoutHandle = setTimeout(() => {
                if (!sessionCompleted && !isCleaningUp) {
                    if (!responseSent && !res.headersSent) {
                        res.status(408).send({ error: 'Timeout' });
                    }
                    cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error('Init error:', err);
            if (!responseSent && !res.headersSent) {
                res.status(503).send({ error: 'Service error' });
            }
            cleanup('init_error');
        }
    }

    await initiateSession();
});

// Cleanup old sessions
setInterval(async () => {
    try {
        if (!fs.existsSync('./qr_sessions')) return;
        const sessions = await fs.readdir('./qr_sessions');
        const now = Date.now();
        for (const s of sessions) {
            const p = `./qr_sessions/${s}`;
            try {
                const stat = await fs.stat(p);
                if (now - stat.mtimeMs > 300000) {
                    await fs.remove(p);
                    console.log(`🗑️ Removed old QR: ${s}`);
                }
            } catch (e) {}
        }
    } catch (e) {}
}, 60000);

export default router;