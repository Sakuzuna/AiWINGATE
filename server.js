const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());

// Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 150 * 1024 * 1024, // 150MB limit per file
        files: 10 // Maximum 10 files
    }
});

// In-memory store for active pages and sessions
const activeAiPages = new Map(); // Key: randomString, Value: { timeout, username }
const activeAuthPages = new Map(); // Key: randomString, Value: { timeout }
const sessions = new Map(); // Key: sessionToken, Value: username
const INACTIVITY_TIMEOUT = 2 * 24 * 60 * 60 * 1000; // 2 days
const CHAT_EXPIRATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
const MAX_CHATS_PER_USER = 3;

// In-memory Set to track IPs that have passed the captcha
const passedIps = new Set();

// In-memory store for chats (keyed by username)
let chats = {};
const chatsFilePath = path.join(__dirname, 'chats.json');

// Load chats from file on startup
if (fs.existsSync(chatsFilePath)) {
    const data = fs.readFileSync(chatsFilePath, 'utf8');
    chats = JSON.parse(data || '{}');
}

// Function to save chats to file
function saveChats() {
    fs.writeFileSync(chatsFilePath, JSON.stringify(chats, null, 2));
}

// Function to generate a random string (12 characters)
function generateRandomString() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// Function to generate a session token (longer for security)
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Function to log IP address to ip.txt
const logIpAddress = (ip) => {
    const ipFilePath = path.join(__dirname, 'ip.txt');
    const logEntry = `${new Date().toISOString()} - ${ip}\n`;
    fs.appendFileSync(ipFilePath, logEntry);
    console.log(`Logged IP: ${ip}`);
};

// Function to hash password using SHA-256
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Function to clean up an AI page
function cleanupAiPage(randomString) {
    if (activeAiPages.has(randomString)) {
        clearTimeout(activeAiPages.get(randomString).timeout);
        activeAiPages.delete(randomString);
        console.log(`Cleaned up AI page: /ai/${randomString}`);
    }
}

// Function to clean up auth page
function cleanupAuthPage(randomString) {
    if (activeAuthPages.has(randomString)) {
        clearTimeout(activeAuthPages.get(randomString).timeout);
        activeAuthPages.delete(randomString);
        console.log(`Cleaned up auth page: /auth/${randomString}`);
    }
}

// Function to format AI response
function formatResponse(text) {
    let formatted = text;

    // Handle code blocks (```language\ncode\n``` or ```\ncode\n```)
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, language, code) => {
        return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
    });

    // Convert ### to <h1> (large bold headings)
    formatted = formatted.replace(/###\s*(.+?)(:)?/g, (match, title, colon) => {
        return colon ? `<h1>${title}</h1><br>` : `<h1>${title}</h1>`;
    });

    // Convert ## to <h2> (medium bold headings, uppercase)
    formatted = formatted.replace(/##\s*(.+?)(:)?/g, (match, title, colon) => {
        return colon ? `<h2 style="text-transform: uppercase;">${title}</h2><br>` : `<h2 style="text-transform: uppercase;">${title}</h2>`;
    });

    // Convert # to <h3> (slightly smaller bold headings)
    formatted = formatted.replace(/#\s*(.+?)(:)?/g, (match, title, colon) => {
        return colon ? `<h3>${title}</h3><br>` : `<h3>${title}</h3>`;
    });

    // Convert **text** to small, bold text
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<span style="font-size: 0.9em; font-weight: bold;">$1</span>');

    // Convert *text* or _text_ to italic
    formatted = formatted.replace(/[_\*](.+?)[_\*]/g, '<em>$1</em>');

    // Split by periods and wrap in paragraphs, preserving other formatting
    formatted = formatted.split(/(?<!\w)\.(?!\w)/).map(segment => {
        segment = segment.trim();
        return segment ? `<p>${segment}.</p>` : '';
    }).join('');

    // Convert lines starting with - to bullet points
    formatted = formatted.replace(/<p>- (.+?)<\/p>/g, '<ul><li>$1</li></ul>');

    return formatted;
}

// Root route: Check cookie or IP for authentication
app.get('/', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp);

    const sessionToken = req.cookies.sessionToken;
    if (sessionToken && sessions.has(sessionToken)) {
        const username = sessions.get(sessionToken);
        const randomString = generateRandomString();
        const timeout = setTimeout(() => cleanupAiPage(randomString), INACTIVITY_TIMEOUT);
        activeAiPages.set(randomString, { timeout, username });
        res.redirect(`/ai/${randomString}`);
    } else if (passedIps.has(clientIp)) {
        const randomString = generateRandomString();
        const timeout = setTimeout(() => cleanupAuthPage(randomString), INACTIVITY_TIMEOUT);
        activeAuthPages.set(randomString, { timeout });
        res.redirect(`/auth/${randomString}`);
    } else {
        const randomString = generateRandomString();
        res.redirect(`/captcha/${randomString}`);
    }
});

// Captcha route: Serve captcha page with random string in URL
app.get('/captcha/:randomString', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp);

    const sessionToken = req.cookies.sessionToken;
    if (sessionToken && sessions.has(sessionToken)) {
        const username = sessions.get(sessionToken);
        const randomString = generateRandomString();
        const timeout = setTimeout(() => cleanupAiPage(randomString), INACTIVITY_TIMEOUT);
        activeAiPages.set(randomString, { timeout, username });
        res.redirect(`/ai/${randomString}`);
    } else if (passedIps.has(clientIp)) {
        const randomString = generateRandomString();
        const timeout = setTimeout(() => cleanupAuthPage(randomString), INACTIVITY_TIMEOUT);
        activeAuthPages.set(randomString, { timeout });
        res.redirect(`/auth/${randomString}`);
    } else {
        res.sendFile(path.join(__dirname, 'views', 'captcha.html'));
    }
});

// Auth route: Serve combined signup/login page
app.get('/auth/:randomString', (req, res) => {
    const randomString = req.params.randomString;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp);

    if (!activeAuthPages.has(randomString)) {
        return res.status(404).send('This auth page has expired or does not exist.');
    }

    clearTimeout(activeAuthPages.get(randomString).timeout);
    const timeout = setTimeout(() => cleanupAuthPage(randomString), INACTIVITY_TIMEOUT);
    activeAuthPages.set(randomString, { timeout });

    res.sendFile(path.join(__dirname, 'views', 'auth.html'));
});

// AI route: Serve AI page with random string in URL
app.get('/ai/:randomString', (req, res) => {
    const randomString = req.params.randomString;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp);

    if (!activeAiPages.has(randomString)) {
        return res.status(404).send('This AI page has expired or does not exist.');
    }

    clearTimeout(activeAiPages.get(randomString).timeout);
    const timeout = setTimeout(() => cleanupAiPage(randomString), INACTIVITY_TIMEOUT);
    activeAiPages.set(randomString, { timeout, username: activeAiPages.get(randomString).username });

    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Endpoint to register a new auth page (called from captcha.html)
app.post('/register-ai-page', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    passedIps.add(clientIp);
    console.log(`IP ${clientIp} passed the captcha`);

    const randomString = generateRandomString();
    const timeout = setTimeout(() => cleanupAuthPage(randomString), INACTIVITY_TIMEOUT);
    activeAuthPages.set(randomString, { timeout });
    res.json({ randomString });
});

// Endpoint to handle signup
app.post('/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const hashedPassword = hashPassword(password);
    const passFilePath = path.join(__dirname, 'pass.txt');
    const entry = `${username}:${hashedPassword}\n`;
    fs.appendFileSync(passFilePath, entry);
    console.log(`Saved credentials: ${username}:${hashedPassword}`);

    const randomString = generateRandomString();
    const timeout = setTimeout(() => cleanupAiPage(randomString), INACTIVITY_TIMEOUT);
    const sessionToken = generateSessionToken();
    sessions.set(sessionToken, username);
    activeAiPages.set(randomString, { timeout, username });
    res.cookie('sessionToken', sessionToken, { maxAge: 10 * 365 * 24 * 60 * 60 * 1000, httpOnly: true }); // 10 years
    res.json({ randomString });
});

// Endpoint to handle login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const passFilePath = path.join(__dirname, 'pass.txt');
    const credentials = fs.existsSync(passFilePath) ? fs.readFileSync(passFilePath, 'utf8').split('\n') : [];
    const hashedInputPassword = hashPassword(password);
    const userEntry = credentials.find(line => {
        const [storedUsername, storedPassword] = line.split(':');
        return storedUsername === username && storedPassword === hashedInputPassword;
    });

    if (userEntry) {
        const randomString = generateRandomString();
        const timeout = setTimeout(() => cleanupAiPage(randomString), INACTIVITY_TIMEOUT);
        const sessionToken = generateSessionToken();
        sessions.set(sessionToken, username);
        activeAiPages.set(randomString, { timeout, username });
        res.cookie('sessionToken', sessionToken, { maxAge: 10 * 365 * 24 * 60 * 60 * 1000, httpOnly: true }); // 10 years
        res.json({ randomString });
    } else {
        const usernameExists = credentials.some(line => line.startsWith(`${username}:`));
        if (usernameExists) {
            res.status(401).json({ error: 'Invalid password' });
        } else {
            res.status(401).json({ error: 'Invalid username or password' });
        }
    }
});

// Endpoint to handle signout
app.post('/signout', (req, res) => {
    const sessionToken = req.cookies.sessionToken;
    const { randomString } = req.body;
    if (sessionToken && sessions.has(sessionToken)) {
        sessions.delete(sessionToken);
    }
    if (randomString) {
        cleanupAiPage(randomString);
    }
    res.clearCookie('sessionToken');
    res.redirect('/');
});

// Endpoint to create a new chat
app.post('/create-chat', (req, res) => {
    const { randomString } = req.body;
    if (!randomString || !activeAiPages.has(randomString)) {
        return res.status(401).json({ error: 'Unauthorized or invalid session' });
    }

    const username = activeAiPages.get(randomString).username;
    if (!chats[username]) {
        chats[username] = [];
    }

    chats[username] = chats[username].filter(chat => {
        const age = Date.now() - chat.createdAt;
        return age < CHAT_EXPIRATION;
    });

    if (chats[username].length >= MAX_CHATS_PER_USER) {
        return res.status(403).json({ error: 'Chat limit reached. Delete an old chat to create a new one.' });
    }

    const chatId = generateRandomString();
    chats[username].push({
        id: chatId,
        createdAt: Date.now(),
        messages: []
    });
    saveChats();
    res.json({ chatId });
});

// Endpoint to get all chats for a user
app.get('/get-chats', (req, res) => {
    const randomString = req.query.randomString;
    if (!randomString || !activeAiPages.has(randomString)) {
        return res.status(401).json({ error: 'Unauthorized or invalid session' });
    }

    const username = activeAiPages.get(randomString).username;
    if (!chats[username]) {
        chats[username] = [];
    }

    chats[username] = chats[username].filter(chat => {
        const age = Date.now() - chat.createdAt;
        return age < CHAT_EXPIRATION;
    });
    saveChats();

    res.json(chats[username]);
});

// Endpoint to save a message to a chat
app.post('/save-message', (req, res) => {
    const { chatId, message, isUser, randomString } = req.body;
    if (!randomString || !activeAiPages.has(randomString)) {
        return res.status(401).json({ error: 'Unauthorized or invalid session' });
    }

    const username = activeAiPages.get(randomString).username;
    if (!chats[username]) {
        return res.status(404).json({ error: 'Chat not found' });
    }

    const chat = chats[username].find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
    }

    chat.messages.push({ content: message, isUser, timestamp: Date.now() });
    saveChats();
    res.sendStatus(200);
});

// Endpoint to clean up an AI page when the user leaves
app.post('/cleanup-ai-page', (req, res) => {
    const { randomString } = req.body;
    if (randomString) {
        cleanupAiPage(randomString);
    }
    res.sendStatus(200);
});

// /generate endpoint (text generation)
app.post('/generate', async (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }

    const llamaApiKey = process.env.LLAMA_API_KEY;
    if (!llamaApiKey) {
        return res.status(500).json({ error: 'Server configuration error: Llama API key missing' });
    }

    try {
        const llamaResponse = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
            model: 'deepseek/deepseek-chat',
            messages: [{ role: 'user', content: message }],
            max_tokens: 512,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${llamaApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const rawAnswer = llamaResponse.data.choices?.[0]?.message?.content || 'No valid response from Llama';
        const formattedAnswer = formatResponse(rawAnswer);
        res.json({ answer: formattedAnswer });
    } catch (error) {
        handleError(error, res);
    }
});

// /generate-image endpoint (image generation)
app.post('/generate-image', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'No prompt provided' });
    }

    const fluxApiKey = process.env.FLUX_API_KEY;
    if (!fluxApiKey) {
        return res.status(500).json({ error: 'Server configuration error: Flux API key missing' });
    }

    try {
        const fluxResponse = await axios.post('https://api.aimlapi.com/v1/images/generations', {
            model: 'flux-pro/v1.1-ultra',
            prompt: prompt,
            width: 1024,
            height: 1024,
            num_outputs: 1,
            quality: 90,
        }, {
            headers: {
                'Authorization': `Bearer ${fluxApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const imageUrl = fluxResponse.data.data?.[0]?.url;
        if (!imageUrl) {
            throw new Error('No image URL returned from Flux API');
        }

        // Return HTML to embed the image in the chat
        const formattedResponse = `
            <p>Generated Image:</p>
            <img src="${imageUrl}" alt="Generated Image" style="max-width: 100%; border-radius: 10px;">
            <a href="${imageUrl}" download="generated-image.jpg" style="display: inline-block; padding: 5px 10px; background: #3e4684; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px;">Download</a>
        `;
        res.json({ answer: formattedResponse });
    } catch (error) {
        handleError(error, res);
    }
});

// /upload endpoint
app.post('/upload', async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);
    const maxSize = 150 * 1024 * 1024;
    if (totalSize > maxSize) {
        return res.status(400).json({ error: 'Total file size exceeds 150MB limit' });
    }

    const llamaApiKey = process.env.LLAMA_API_KEY;
    if (!llamaApiKey) {
        return res.status(500).json({ error: 'Server configuration error: API key missing' });
    }

    const prompt = req.body.prompt || 'Analyze these files';
    const textExtensions = ['.txt', '.rtf', '.doc', '.docx', '.odt', '.pdf', '.md', '.tex', '.html', '.htm', '.xml', '.json', '.yaml', '.yml', '.csv', '.sql', '.ini', '.properties', '.env', '.toml'];
    const imageExtensions = ['.jpg', '.png'];

    try {
        let combinedResponse = '';
        for (const file of req.files) {
            const fileName = file.originalname.toLowerCase();
            const fileContent = file.buffer;

            const isTextFile = textExtensions.some(ext => fileName.endsWith(ext));
            const isImageFile = imageExtensions.some(ext => fileName.endsWith(ext));

            let response;
            if (isTextFile) {
                const textContent = fileContent.toString('utf8');
                const message = `${prompt}\n\nFile: ${fileName}\nContent:\n${textContent.substring(0, 1000)}...`;

                response = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
                    model: 'gpt-4o-2024-05-13',
                    messages: [{ role: 'user', content: message }],
                    max_tokens: 512,
                    temperature: 0.7,
                }, {
                    headers: {
                        'Authorization': `Bearer ${llamaApiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
            } else if (isImageFile) {
                const base64Image = fileContent.toString('base64');
                const message = `${prompt}\n\nFile: ${fileName}\nImage content (base64): ${base64Image.substring(0, 1000)}...`;

                response = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
                    model: 'gemini-2.0-flash-thinking-exp-01-21',
                    messages: [{ role: 'user', content: message }],
                    max_tokens: 512,
                    temperature: 0.7,
                }, {
                    headers: {
                        'Authorization': `Bearer ${llamaApiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
            } else {
                return res.status(400).json({ error: `Unsupported file type for ${fileName}. Please upload a text file or image.` });
            }

            const rawAnswer = response.data.choices?.[0]?.message?.content || `Failed to process file ${fileName}`;
            combinedResponse += `### Analysis for ${fileName}\n${rawAnswer}\n\n`;
        }

        const formattedAnswer = formatResponse(combinedResponse);
        res.json({ answer: formattedAnswer });
    } catch (error) {
        handleError(error, res);
    }
});

function handleError(error, res) {
    if (error.response) {
        console.error('API error:', error.response.data);
        if (error.response.status === 403 || error.response.status === 429) {
            res.status(error.response.status).json({
                error: 'API usage limit reached or access denied.'
            });
        } else {
            res.status(error.response.status).json({ error: error.response.data.message || 'Error' });
        }
    } else if (error.request) {
        console.error('No response from API:', error.request);
        res.status(500).json({ error: 'No response from API.' });
    } else {
        console.error('Error setting up API request:', error.message);
        res.status(500).json({ error: 'Error setting up request: ' + error.message });
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
