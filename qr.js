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
import fetch from 'node-fetch';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 5;
const SESSION_TIMEOUT = 60000;

// 🔁 IMAGE URL
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
    await fs.ensureDir(dirs);

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
                res.status(503).json({ 
                    success: false,
                    error: 'Maximum reconnection attempts reached' 
                });
                responseSent = true;
            }
            return cleanup('max_reconnects');
        }

        try {
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
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                shouldSyncHistory: false,
            });

            const sock = currentSocket;

            // QR Code handler
            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent || sessionCompleted || isCleaningUp) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { 
                        errorCorrectionLevel: 'M',
                        width: 400,
                        margin: 2
                    });
                    
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.json({
                            success: true,
                            qr: qrDataURL,
                            message: 'Scan QR code with WhatsApp',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Tap Menu (3 dots) or Settings',
                                '3. Select "Linked Devices"',
                                '4. Tap "Link a Device"',
                                '5. Scan this QR code'
                            ],
                            sessionId: sessionId,
                            expiresIn: '60 seconds'
                        });
                        console.log(`✅ QR code sent for session: ${sessionId}`);
                    }
                } catch (err) {
                    console.error('QR generation error:', err);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).json({ 
                            success: false,
                            error: 'Failed to generate QR code' 
                        });
                    }
                    cleanup('qr_error');
                }
            };

            // Connection update handler
            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                
                const { connection, lastDisconnect, qr, isNewLogin } = update;

                // Handle QR code
                if (qr && !qrGenerated && !sessionCompleted && !responseSent) {
                    await handleQRCode(qr);
                }

                // Handle new login
                if (isNewLogin) {
                    console.log(`🔐 New login for session: ${sessionId}`);
                }

                // Handle successful connection
                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        
                        if (fs.existsSync(credsFile)) {
                            console.log(`📤 Uploading session data for: ${sessionId}`);
                            
                            // Upload to gist
                            const sessionCode = await uploadToGist(credsFile, 'creds.json');
                            
                            // Get user JID
                            const userJid = sock.authState.creds?.me?.id 
                                ? jidNormalizedUser(sock.authState.creds.me.id) 
                                : null;

                            if (userJid) {
                                // Send session code - PLAIN TEXT
                                await sock.sendMessage(userJid, { 
                                    text: `*SESSION CODE*
                                    
Your Session Code:
${sessionCode}

Instructions:
• Copy the code above
• Paste in your bot
• Keep it secret!

Generated by: STANY TZ
Session: ${sessionId.slice(-6)}` 
                                });

                                // Send image with info - PLAIN TEXT
                                try {
                                    const imgRes = await fetch(IMAGE_URL);
                                    if (imgRes.ok) {
                                        const imgBuffer = await imgRes.buffer();
                                        await sock.sendMessage(userJid, {
                                            image: imgBuffer,
                                            caption: `SESSION GENERATED SUCCESSFULLY

STANY TZ BOT

Session Details:
• ID: ${sessionId.slice(-8)}
• Status: ✅ Active
• Type: QR Login

Important Links:
• GitHub: https://github.com/Stanytz378/IAMLEGEND
• Group: https://chat.whatsapp.com/J19JASXoaK0GVSoRvShr4Y
• Channel: https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p

Thank you for using STANY TZ Bot!
Star us on GitHub if you like!`
                                        });
                                        console.log(`✅ Image sent for session: ${sessionId}`);
                                    }
                                } catch (imgErr) {
                                    console.log(`⚠️ Image send failed (non-critical): ${sessionId}`);
                                }
                            }
                            console.log(`✅ Session completed for: ${sessionId}`);
                        }
                    } catch (err) {
                        console.error(`❌ Error after connection: ${err.message}`);
                    } finally {
                        cleanup('complete');
                    }
                }

                // Handle disconnection
                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) return cleanup('already_complete');
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    // Check if logged out
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log(`❌ Logged out for session: ${sessionId}`);
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.json({ 
                                success: false,
                                error: 'Session expired - please try again' 
                            });
                        }
                        return cleanup('logged_out');
                    }
                    
                    // Try to reconnect if QR was generated but not completed
                    if (qrGenerated && !sessionCompleted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} for: ${sessionId}`);
                        
                        if (currentSocket) {
                            try {
                                currentSocket.ev.removeAllListeners();
                                await currentSocket.end();
                            } catch (e) {}
                            currentSocket = null;
                        }
                        
                        await delay(3000);
                        return initiateSession();
                    }
                    
                    // Handle other disconnections
                    if (!sessionCompleted && !responseSent && !res.headersSent) {
                        console.log(`❌ Connection failed for session: ${sessionId}`);
                        responseSent = true;
                        res.status(500).json({ 
                            success: false,
                            error: 'Connection failed - please try again' 
                        });
                    }
                    cleanup('closed');
                }
            });

            // Save credentials
            sock.ev.on('creds.update', saveCreds);

            // Set timeout
            timeoutHandle = setTimeout(() => {
                if (!sessionCompleted && !isCleaningUp) {
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).json({ 
                            success: false,
                            error: 'Request timeout - please try again' 
                        });
                    }
                    cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error(`❌ Init error for ${sessionId}:`, err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(500).json({ 
                    success: false,
                    error: 'Failed to initialize session' 
                });
            }
            cleanup('init_error');
        }
    }

    await initiateSession();
});

// Cleanup old sessions - runs every 5 minutes
setInterval(async () => {
    try {
        if (!fs.existsSync('./qr_sessions')) return;
        
        const sessions = await fs.readdir('./qr_sessions');
        const now = Date.now();
        let cleaned = 0;

        for (const session of sessions) {
            const sessionPath = `./qr_sessions/${session}`;
            try {
                const stats = await fs.stat(sessionPath);
                // Remove sessions older than 5 minutes
                if (now - stats.mtimeMs > 300000) {
                    await fs.remove(sessionPath);
                    cleaned++;
                }
            } catch (err) {
                console.log(`⚠️ Error cleaning ${session}:`, err.message);
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} old sessions`);
        }
    } catch (err) {
        console.log('⚠️ Cleanup error:', err.message);
    }
}, 300000);

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        sessions: fs.existsSync('./qr_sessions') ? fs.readdirSync('./qr_sessions').length : 0
    });
});

export default router;