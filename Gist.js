// Gist.js
import fs from 'fs-extra';
import fetch from 'node-fetch';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'stanytz378';

/**
 * Read content from various input types:
 * - Buffer
 * - String (already content)
 * - Data URL (base64)
 * - HTTP URL (returns the URL itself, not fetched content)
 * - File path (reads file)
 */
function readContent(input) {
    if (Buffer.isBuffer(input)) return input.toString();
    if (typeof input !== 'string') throw new Error('Unsupported input type.');
    if (input.startsWith('data:')) return Buffer.from(input.split(',')[1], 'base64').toString();
    if (input.startsWith('http://') || input.startsWith('https://')) return input; // return URL as is
    if (fs.existsSync(input)) return fs.readFileSync(input, 'utf8');
    return input; // assume it's already content
}

/**
 * Create a secret Gist on GitHub
 * @param {string} content - File content
 * @param {string} filename - Name of file in Gist (default: creds.json)
 * @returns {Promise<string>} Gist ID
 */
async function createSecretGist(content, filename = 'creds.json') {
    if (!GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable not set');
    }

    const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            description: 'WhatsApp Bot Session',
            public: false, // secret gist
            files: {
                [filename]: {
                    content: content,
                },
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub Gist error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.id; // return only the Gist ID, not the full URL
}

/**
 * Upload content to GitHub Gist and return custom session ID
 * @param {string|Buffer} input - File path, content, or Buffer
 * @param {string} filename - Name of file in Gist (default: creds.json)
 * @returns {Promise<string>} Session ID in format "Stanytz378/IAMLEGEND_<gistId>"
 */
async function uploadToGist(input, filename = 'creds.json') {
    try {
        const content = readContent(input);
        const gistId = await createSecretGist(content, filename);

        // Custom session ID format
        const sessionId = `Stanytz378/IAMLEGEND_${gistId}`;
        
        console.log('✅ Session gist created:', sessionId);
        console.log('📌 Raw URL:', `https://gist.githubusercontent.com/${GITHUB_USERNAME}/${gistId}/raw/${filename}`);

        return sessionId;
    } catch (error) {
        console.error('❌ Error uploading to GitHub Gist:', error.message);
        throw error; // re-throw so caller knows it failed
    }
}

export default uploadToGist;