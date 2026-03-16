import fs from 'fs';

const PASTEBIN_API_KEY = process.env.PASTEBIN_API_KEY || '';

function readContent(input) {
    if (!input) throw new Error('Input is empty or undefined');
    
    if (Buffer.isBuffer(input)) return input.toString();
    if (typeof input !== 'string') throw new Error('Unsupported input type.');
    
    // Handle data URLs
    if (input.startsWith('data:')) {
        const base64Data = input.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL');
        return Buffer.from(base64Data, 'base64').toString();
    }
    
    // Handle URLs - but we need content, not URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
        throw new Error('URL input not supported - provide file content or path');
    }
    
    // Handle file paths
    if (fs.existsSync(input)) {
        const content = fs.readFileSync(input, 'utf8');
        if (!content) throw new Error(`File ${input} is empty`);
        return content;
    }
    
    // Handle direct string content
    if (!input.trim()) throw new Error('Content is empty');
    return input;
}

async function uploadViaPastebin(content, title, format, privacy) {
    if (!content || !content.trim()) {
        throw new Error('Cannot upload empty content to Pastebin');
    }
    
    if (!PASTEBIN_API_KEY) {
        throw new Error('PASTEBIN_API_KEY is required for Pastebin uploads');
    }
    
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
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });

    const text = await res.text();
    if (!text.startsWith('https://')) throw new Error(`Pastebin error: ${text}`);
    return text.trim();
}

async function uploadViaPasteRs(content) {
    if (!content || !content.trim()) {
        throw new Error('Cannot upload empty content to paste.rs');
    }
    
    const res = await fetch('https://paste.rs/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
    });

    if (!res.ok) throw new Error(`paste.rs error: ${res.status}`);
    const url = await res.text();
    return url.trim();
}

async function uploadToPastebin(input, title = 'Untitled', format = 'json', privacy = '1') {
    try {
        console.log('📝 Reading content...');
        const content = readContent(input);
        
        if (!content || !content.trim()) {
            throw new Error('Content is empty after reading');
        }
        
        console.log(`📊 Content length: ${content.length} characters`);
        console.log(`🔑 API Key ${PASTEBIN_API_KEY ? 'found' : 'not found'}`);
        
        let pasteUrl;

        if (PASTEBIN_API_KEY) {
            console.log('📤 Uploading to Pastebin...');
            pasteUrl = await uploadViaPastebin(content, title, format, privacy);
        } else {
            console.log('⚠️ No PASTEBIN_API_KEY set, using paste.rs as fallback');
            pasteUrl = await uploadViaPasteRs(content);
        }

        const pasteId = pasteUrl.replace(/https?:\/\/[^/]+\//, '');
        const customUrl = `Stanytz378/IAMLEGEND_${pasteId}`;

        console.log('✅ Session paste URL:', customUrl);
        return customUrl;
    } catch (error) {
        console.error('❌ Error uploading paste:', error.message);
        throw error;
    }
}

export default uploadToPastebin;