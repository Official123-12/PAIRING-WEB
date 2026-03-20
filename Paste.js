/*****************************************************************************
 *                                                                           *
 *                     Developed By STANY TZ                                 *
 *                                                                           *
 *  🌐  GitHub   : https://github.com/Stanytz378/iamlegendv2                 *
 *  ▶️  YouTube  : https://youtube.com/@STANYTZ                              *
 *  💬  WhatsApp : https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p     *
 *                                                                           *
 *    © 2026 STANY TZ. All rights reserved.                                 *
 *                                                                           *
 *    Description: Upload session credentials to Pastebin or paste.rs       *
 *                 with automatic fallback when Pastebin limit is reached.  *
 *                                                                           *
 ***************************************************************************/

import fs from 'fs';

const PASTEBIN_API_KEY = process.env.PASTEBIN_API_KEY || '';

/**
 * Reads content from various input types:
 * - Buffer → string
 * - string → if it's a data URL, decode; if file path, read file; else return as is
 */
function readContent(input) {
    if (Buffer.isBuffer(input)) return input.toString();
    if (typeof input !== 'string') throw new Error('Unsupported input type.');
    if (input.startsWith('data:')) return Buffer.from(input.split(',')[1], 'base64').toString();
    if (input.startsWith('http://') || input.startsWith('https://')) return input;
    if (fs.existsSync(input)) return fs.readFileSync(input, 'utf8');
    return input;
}

/**
 * Upload content to Pastebin
 */
async function uploadViaPastebin(content, title, format, privacy) {
    const privacyMap = { '0': 0, '1': 1, '2': 2 };
    const body = new URLSearchParams({
        api_dev_key: PASTEBIN_API_KEY,
        api_option: 'paste',
        api_paste_code: content,
        api_paste_name: title,
        api_paste_format: format,
        api_paste_private: String(privacyMap[privacy] ?? 1),
        api_paste_expire_date: 'N',
    });

    const res = await fetch('https://pastebin.com/api/api_post.php', {
        method: 'POST',
        body,
    });

    const text = await res.text();
    if (!text.startsWith('https://')) throw new Error(`Pastebin error: ${text}`);
    return text.trim();
}

/**
 * Upload content to paste.rs (no API key needed)
 */
async function uploadViaPasteRs(content) {
    const res = await fetch('https://paste.rs/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
    });

    if (!res.ok) throw new Error(`paste.rs error: ${res.status}`);
    return (await res.text()).trim();
}

/**
 * Upload session data to Pastebin (or paste.rs as fallback) and return custom session ID.
 * Format: Stanytz378/iamlegendv2_<pasteId>
 */
async function uploadSessionToPastebin(input, title = 'iamlegendv2 Session', format = 'json', privacy = '1') {
    const content = readContent(input);
    let pasteUrl;

    // Try Pastebin first if API key exists
    if (PASTEBIN_API_KEY) {
        try {
            pasteUrl = await uploadViaPastebin(content, title, format, privacy);
            console.log('✅ Session uploaded to Pastebin');
        } catch (err) {
            console.log(`⚠️ Pastebin upload failed: ${err.message}. Falling back to paste.rs...`);
            // fallback to paste.rs
            pasteUrl = await uploadViaPasteRs(content);
            console.log('✅ Session uploaded to paste.rs as fallback');
        }
    } else {
        // No API key, use paste.rs directly
        console.log('⚠️ No PASTEBIN_API_KEY set, using paste.rs');
        pasteUrl = await uploadViaPasteRs(content);
    }

    const pasteId = pasteUrl.replace(/https?:\/\/[^/]+\//, '');
    const customId = `Stanytz378/iamlegendv2_${pasteId}`;
    console.log('✅ Session ID:', customId);
    return customId;
}

export default uploadSessionToPastebin;