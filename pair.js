import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';
import uploadToGist from './Gist.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_DELAY = 5000;

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
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: 'Phone number required' });

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        return res.status(400).send({ error: 'Invalid phone number' });
    }
    num = phone.getNumber('e164').replace('+', '');

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./auth_info_baileys/session_${sessionId}`;

    let pairingCodeSent = false;
    let sessionCompleted = false;
    let isCleaningUp = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;

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
        setTimeout(() => removeFile(dirs), CLEANUP_DELAY);
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

        try {
            await fs.ensureDir(dirs);
            const { state, saveCreds } = await useMultiFileAuthState(dirs);
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
            });

            const sock = currentSocket;

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            console.log(`📤 Uploading creds for ${num}...`);
                            const sessionId = await uploadToGist(credsFile, 'creds.json');
                            
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
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
                                console.log('Image send failed, text only');
                            }
                        }
                    } catch (err) {
                        console.error('Send error:', err);
                    } finally {
                        cleanup('complete');
                    }
                }

                if (isNewLogin) console.log(`🔐 New login: ${num}`);

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) return cleanup('already_complete');
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) {
                            res.status(401).send({ error: 'Invalid pairing' });
                        }
                        return cleanup('logged_out');
                    } else if (pairingCodeSent && !sessionCompleted) {
                        reconnectAttempts++;
                        console.log(`🔄 Reconnect ${reconnectAttempts} for ${num}`);
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

            if (!sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
                await delay(1500);
                try {
                    pairingCodeSent = true;
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.send({ code });
                        console.log(`📱 Code sent: ${code} for ${num}`);
                    }
                } catch (error) {
                    console.error('Code error:', error);
                    if (!responseSent && !res.headersSent) {
                        res.status(503).send({ error: 'Failed to get code' });
                    }
                    cleanup('code_error');
                }
            }

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
        const base = './auth_info_baileys';
        if (!fs.existsSync(base)) return;
        const sessions = await fs.readdir(base);
        const now = Date.now();
        for (const s of sessions) {
            const p = `${base}/${s}`;
            try {
                const stat = await fs.stat(p);
                if (now - stat.mtimeMs > 10 * 60 * 1000) {
                    await fs.remove(p);
                    console.log(`🗑️ Removed old: ${s}`);
                }
            } catch (e) {}
        }
    } catch (e) {}
}, 60000);

export default router;