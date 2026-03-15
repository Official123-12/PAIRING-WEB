import fs from 'fs-extra';
import fetch from 'node-fetch';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'stanytz378';

function readContent(input) {
    if (Buffer.isBuffer(input)) return input.toString();
    if (typeof input !== 'string') throw new Error('Unsupported input type.');
    if (input.startsWith('data:')) return Buffer.from(input.split(',')[1], 'base64').toString();
    if (input.startsWith('http://') || input.startsWith('https://')) return input;
    if (fs.existsSync(input)) return fs.readFileSync(input, 'utf8');
    return input;
}

async function createSecretGist(content, filename = 'creds.json') {
    if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set');

    const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            description: `WhatsApp Session - ${new Date().toISOString()}`,
            public: false,
            files: { [filename]: { content } }
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub Gist error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.id;
}

export default async function uploadToGist(input, filename = 'creds.json') {
    try {
        const content = readContent(input);
        const gistId = await createSecretGist(content, filename);
        
        const sessionId = `Stanytz378/IAMLEGEND_${gistId}`;
        console.log(`✅ New Gist created: ${sessionId}`);
        console.log(`📌 Raw URL: https://gist.githubusercontent.com/${GITHUB_USERNAME}/${gistId}/raw/${filename}`);
        
        return sessionId;
    } catch (error) {
        console.error('❌ Upload error:', error.message);
        throw error;
    }
}