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
import fetch from 'node-fetch'; // 🔥 IMPORTANT: Ongeza hii!

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CLEANUP_DELAY = 5000; // 5 seconds

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
    // Set headers early
    res.setHeader('Content-Type', 'application/json');
    
    let num = req.query.number;
    if (!num) {
        return res.status(400).json({ 
            success: false,
            error: 'Phone number required' 
        });
    }

    // Clean phone number
    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    
    if (!phone.isValid()) {
        return res.status(400).json({ 
            success: false,
            error: 'Invalid phone number' 
        });
    }
    
    num = phone.getNumber('e164').replace('+', '');
    console.log(`📞 Pairing request for: ${num}`);

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./auth_info_baileys/session_${sessionId}`;
    
    // Ensure directories exist
    await fs.ensureDir('./auth_info_baileys');
    await fs.ensureDir(dirs);

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
        console.log(`🧹 Cleanup ${sessionId} for ${num}: ${reason}`);
        
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
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                shouldSyncHistory: false,
            });

            const sock = currentSocket;

            // Connection update handler
            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                
                const { connection, lastDisconnect, isNewLogin } = update;

                // Handle new login
                if (isNewLogin) {
                    console.log(`🔐 New login for ${num}`);
                }

                // Handle successful connection
                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;
                    console.log(`✅ Connected successfully for ${num}`);

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        
                        if (fs.existsSync(credsFile)) {
                            console.log(`📤 Uploading session data for ${num}...`);
                            
                            // Upload to gist
                            const sessionCode = await uploadToGist(credsFile, 'creds.json');
                            
                            // Get user JID
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            
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
Number: ${num}
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
• Number: ${num}
• ID: ${sessionId.slice(-8)}
• Status: ✅ Active
• Type: Pairing Code

Important Links:
• GitHub: https://github.com/Stanytz378/IAMLEGEND
• Group: https://chat.whatsapp.com/J19JASXoaK0GVSoRvShr4Y
• Channel: https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p

Thank you for using STANY TZ Bot!
Star us on GitHub if you like!`
                                    });
                                    console.log(`✅ Image sent for ${num}`);
                                }
                            } catch (imgErr) {
                                console.log(`⚠️ Image send failed for ${num} (non-critical)`);
                            }
                        }
                    } catch (err) {
                        console.error(`❌ Error after connection for ${num}:`, err.message);
                    } finally {
                        cleanup('complete');
                    }
                }

                // Handle disconnection
                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) return cleanup('already_complete');
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    // Check if logged out
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log(`❌ Logged out for ${num}`);
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.json({ 
                                success: false,
                                error: 'Session expired - please try again' 
                            });
                        }
                        return cleanup('logged_out');
                    }
                    
                    // Try to reconnect if pairing code was sent but not completed
                    if (pairingCodeSent && !sessionCompleted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} for ${num}`);
                        
                        if (currentSocket) {
                            try {
                                currentSocket.ev.removeAllListeners();
                                await currentSocket.end();
                            } catch (e) {}
                            currentSocket = null;
                        }
                        
                        await delay(2000);
                        return initiateSession();
                    }
                    
                    // Handle other disconnections
                    if (!sessionCompleted && !responseSent && !res.headersSent) {
                        console.log(`❌ Connection failed for ${num}`);
                        responseSent = true;
                        res.status(500).json({ 
                            success: false,
                            error: 'Connection failed - please try again' 
                        });
                    }
                    cleanup('closed');
                }
            });

            // Request pairing code if not registered
            if (!sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
                await delay(1500);
                
                try {
                    pairingCodeSent = true;
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.json({
                            success: true,
                            code: code,
                            message: 'Enter this code in WhatsApp',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Linked Devices',
                                '3. Tap "Link a Device"',
                                `4. Enter this code: ${code}`,
                                '5. Wait for connection'
                            ],
                            number: num,
                            sessionId: sessionId,
                            expiresIn: '5 minutes'
                        });
                        console.log(`✅ Pairing code sent for ${num}: ${code}`);
                    }
                } catch (error) {
                    console.error('❌ Code generation error:', error.message);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(503).json({ 
                            success: false,
                            error: 'Failed to generate pairing code' 
                        });
                    }
                    cleanup('code_error');
                }
            }

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
            console.error(`❌ Init error for ${num}:`, err.message);
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

// Cleanup old sessions - runs every 10 minutes
setInterval(async () => {
    try {
        const base = './auth_info_baileys';
        if (!fs.existsSync(base)) return;
        
        const sessions = await fs.readdir(base);
        const now = Date.now();
        let cleaned = 0;

        for (const session of sessions) {
            const sessionPath = `${base}/${session}`;
            try {
                const stats = await fs.stat(sessionPath);
                // Remove sessions older than 10 minutes
                if (now - stats.mtimeMs > 10 * 60 * 1000) {
                    await fs.remove(sessionPath);
                    cleaned++;
                }
            } catch (err) {
                console.log(`⚠️ Error cleaning ${session}:`, err.message);
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} old pair sessions`);
        }
    } catch (err) {
        console.log('⚠️ Cleanup error:', err.message);
    }
}, 600000); // 10 minutes

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        sessions: fs.existsSync('./auth_info_baileys') ? fs.readdirSync('./auth_info_baileys').length : 0
    });
});

export default router;