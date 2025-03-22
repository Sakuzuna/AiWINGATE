const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// In-memory store for active pages
const activeAiPages = new Map(); // Key: randomString, Value: { timeout }
const activeAuthPages = new Map(); // Combined signup/login pages
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes for pages
const CHAT_EXPIRATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
const MAX_CHATS_PER_USER = 3;

// In-memory Set to track IPs that have passed the captcha
const passedIps = new Set();

// In-memory store for chats (in production, use a database)
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

// Function to log IP address to ip.txt
const logIpAddress = (ip) => {
    const ipFilePath = path.join(__dirname, 'ip.txt');
    const logEntry = `${new Date().toISOString()} - ${ip}\n`;
    fs.appendFileSync(ipFilePath, logEntry);
    console.log(`Logged IP: ${ip}`);
};

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

// Root route: Check if IP has passed captcha, redirect accordingly
app.get('/', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp);

    if (passedIps.has(clientIp)) {
        // IP has already passed the captcha, redirect to auth page
        const randomString = generateRandomString();
        const timeout = setTimeout(() => {
            cleanupAuthPage(randomString);
        }, INACTIVITY_TIMEOUT);
        activeAuthPages.set(randomString, { timeout });
        res.redirect(`/auth/${randomString}`);
    } else {
        // IP hasn't passed the captcha, redirect to a new captcha page
        const randomString = generateRandomString();
        res.redirect(`/captcha/${randomString}`);
    }
});

// Captcha route: Serve captcha page with random string in URL
app.get('/captcha/:randomString', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp);

    if (passedIps.has(clientIp)) {
        const randomString = generateRandomString();
        const timeout = setTimeout(() => {
            cleanupAuthPage(randomString);
        }, INACTIVITY_TIMEOUT);
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
    const timeout = setTimeout(() => {
        cleanupAuthPage(randomString);
    }, INACTIVITY_TIMEOUT);
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
    const timeout = setTimeout(() => {
        cleanupAiPage(randomString);
    }, INACTIVITY_TIMEOUT);
    activeAiPages.set(randomString, { timeout });

    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Endpoint to register a new auth page (called from captcha.html)
app.post('/register-ai-page', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    passedIps.add(clientIp);
    console.log(`IP ${clientIp} passed the captcha`);

    const randomString = generateRandomString();
    const timeout = setTimeout(() => {
        cleanupAuthPage(randomString);
    }, INACTIVITY_TIMEOUT);
    activeAuthPages.set(randomString, { timeout });
    res.json({ randomString });
});

// Endpoint to handle signup
app.post('/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const passFilePath = path.join(__dirname, 'pass.txt');
    const entry = `${username}:${password}\n`;
    fs.appendFileSync(passFilePath, entry);
    console.log(`Saved credentials: ${username}:${password}`);

    const randomString = generateRandomString();
    const timeout = setTimeout(() => {
        cleanupAiPage(randomString);
    }, INACTIVITY_TIMEOUT);
    activeAiPages.set(randomString, { timeout });
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
    const userEntry = credentials.find(line => line === `${username}:${password}`);

    if (userEntry) {
        const randomString = generateRandomString();
        const timeout = setTimeout(() => {
            cleanupAiPage(randomString);
        }, INACTIVITY_TIMEOUT);
        activeAiPages.set(randomString, { timeout });
        res.json({ randomString });
    } else {
        res.status(401).json({ error: 'Invalid username or password' });
    }
});

// Endpoint to create a new chat
app.post('/create-chat', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!chats[clientIp]) {
        chats[clientIp] = [];
    }

    // Check for expired chats and remove them
    chats[clientIp] = chats[clientIp].filter(chat => {
        const age = Date.now() - chat.createdAt;
        return age < CHAT_EXPIRATION;
    });

    // Check chat limit
    if (chats[clientIp].length >= MAX_CHATS_PER_USER) {
        return res.status(403).json({ error: 'Chat limit reached. Delete an old chat to create a new one.' });
    }

    const chatId = generateRandomString();
    chats[clientIp].push({
        id: chatId,
        createdAt: Date.now(),
        messages: []
    });
    saveChats();
    res.json({ chatId });
});

// Endpoint to get all chats for a user
app.get('/get-chats', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!chats[clientIp]) {
        chats[clientIp] = [];
    }

    // Remove expired chats
    chats[clientIp] = chats[clientIp].filter(chat => {
        const age = Date.now() - chat.createdAt;
        return age < CHAT_EXPIRATION;
    });
    saveChats();

    res.json(chats[clientIp]);
});

// Endpoint to save a message to a chat
app.post('/save-message', (req, res) => {
    const { chatId, message, isUser } = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!chats[clientIp]) {
        return res.status(404).json({ error: 'Chat not found' });
    }

    const chat = chats[clientIp].find(c => c.id === chatId);
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

app.post('/generate', async (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }

    const aimlApiKey = process.env.AIML_API_KEY;
    if (!aimlApiKey) {
        return res.status(500).json({ error: 'Server configuration error: AI/ML API key missing' });
    }

    try {
        const response = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
            model: 'meta-llama/Llama-3-8b-chat-hf',
            messages: [{ role: 'user', content: message }],
            max_tokens: 512,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${aimlApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const answer = response.data.choices?.[0]?.message?.content || 'No valid response';
        res.json({ answer });
    } catch (error) {
        handleError(error, res);
    }
});

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileContent = req.file.buffer.toString('utf8');
    const prompt = req.body.prompt || 'Analyze this file';
    const message = `${prompt}\n\nFile content:\n${fileContent.substring(0, 1000)}...`;

    const aimlApiKey = process.env.AIML_API_KEY;
    if (!aimlApiKey) {
        return res.status(500).json({ error: 'Server configuration error: AI/ML API key missing' });
    }

    try {
        const response = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
            model: 'meta-llama/Llama-3-8b-chat-hf',
            messages: [{ role: 'user', content: message }],
            max_tokens: 512,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${aimlApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const answer = response.data.choices?.[0]?.message?.content || 'No valid response';
        res.json({ answer });
    } catch (error) {
        handleError(error, res);
    }
});

function handleError(error, res) {
    if (error.response) {
        console.error('AI/ML API error:', error.response.data);
        if (error.response.status === 403 || error.response.status === 429) {
            res.status(error.response.status).json({
                error: 'AI/ML API usage limit reached or access denied.'
            });
        } else {
            res.status(error.response.status).json({ error: error.response.data.message || 'Error' });
        }
    } else if (error.request) {
        console.error('No response from AI/ML API:', error.request);
        res.status(500).json({ error: 'No response from AI/ML API.' });
    } else {
        console.error('Error setting up AI/ML API request:', error.message);
        res.status(500).json({ error: 'Error setting up request: ' + error.message });
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
