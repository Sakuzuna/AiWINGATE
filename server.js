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
const upload = multer({ storage: storage });

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

// Root route: Check cookie or IP for authentication
app.get('/', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp);

    const sessionToken = req.cookies.sessionToken;
    if (sessionToken && sessions.has(sessionToken)) {
        const username = sessions.get(sessionToken);
        const randomString = generateRandomString();
        const timeout = setTimeout(() => {
            cleanupAiPage(randomString);
        }, INACTIVITY_TIMEOUT);
        activeAiPages.set(randomString, { timeout, username });
        res.redirect(`/ai/${randomString}`);
    } else if (passedIps.has(clientIp)) {
        const randomString = generateRandomString();
        const timeout = setTimeout(() => {
            cleanupAuthPage(randomString);
        }, INACTIVITY_TIMEOUT);
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
        const timeout = setTimeout(() => {
            cleanupAiPage(randomString);
        }, INACTIVITY_TIMEOUT);
        activeAiPages.set(randomString, { timeout, username });
        res.redirect(`/ai/${randomString}`);
    } else if (passedIps.has(clientIp)) {
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
    activeAiPages.set(randomString, { timeout, username: activeAiPages.get(randomString).username });

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

    const hashedPassword = hashPassword(password);
    const passFilePath = path.join(__dirname, 'pass.txt');
    const entry = `${username}:${hashedPassword}\n`;
    fs.appendFileSync(passFilePath, entry);
    console.log(`Saved credentials: ${username}:${hashedPassword}`);

    const randomString = generateRandomString();
    const timeout = setTimeout(() => {
        cleanupAiPage(randomString);
    }, INACTIVITY_TIMEOUT);
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
        const timeout = setTimeout(() => {
            cleanupAiPage(randomString);
        }, INACTIVITY_TIMEOUT);
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

// Updated /generate endpoint
app.post('/generate', async (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }

    const gptApiKey = process.env.GPT_API_KEY;
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const llamaApiKey = process.env.LLAMA_API_KEY;

    if (!gptApiKey || !deepseekApiKey || !geminiApiKey || !llamaApiKey) {
        return res.status(500).json({ error: 'Server configuration error: One or more API keys missing' });
    }

    try {
        // Concurrently fetch responses from GPT-4.5-preview, DeepSeek R1, and Gemini-1.5-pro via AIML API
        const [gptResponse, deepseekResponse, geminiResponse] = await Promise.all([
            axios.post('https://api.aimlapi.com/v1/chat/completions', {
                model: 'gpt-4.5-preview',
                messages: [{ role: 'user', content: message }],
                max_tokens: 512,
                temperature: 0.7,
            }, {
                headers: {
                    'Authorization': `Bearer ${gptApiKey}`,
                    'Content-Type': 'application/json'
                }
            }).catch(err => {
                console.error('GPT Error:', err.response?.data || err.message);
                return { data: { choices: [{ message: { content: 'GPT-4.5 failed to respond' } }] } };
            }),

            axios.post('https://api.aimlapi.com/v1/chat/completions', {
                model: 'deepseek-r1',
                messages: [{ role: 'user', content: message }],
                max_tokens: 512,
                temperature: 0.7,
            }, {
                headers: {
                    'Authorization': `Bearer ${deepseekApiKey}`,
                    'Content-Type': 'application/json'
                }
            }).catch(err => {
                console.error('DeepSeek Error:', err.response?.data || err.message);
                return { data: { choices: [{ message: { content: 'DeepSeek failed to respond' } }] } };
            }),

            axios.post('https://api.aimlapi.com/v1/chat/completions', {
                model: 'gemini-1.5-pro',
                messages: [{ role: 'user', content: message }],
                max_tokens: 512,
                temperature: 0.7,
            }, {
                headers: {
                    'Authorization': `Bearer ${geminiApiKey}`,
                    'Content-Type': 'application/json'
                }
            }).catch(err => {
                console.error('Gemini Error:', err.response?.data || err.message);
                return { data: { choices: [{ message: { content: 'Gemini failed to respond' } }] } };
            }),
        ]);

        // Extract responses
        const gptText = gptResponse.data.choices?.[0]?.message?.content || 'No valid response from GPT';
        const deepseekText = deepseekResponse.data.choices?.[0]?.message?.content || 'No valid response from DeepSeek';
        const geminiText = geminiResponse.data.choices?.[0]?.message?.content || 'No valid response from Gemini';

        // Log the intermediate responses for debugging
        console.log('GPT Response:', gptText);
        console.log('DeepSeek Response:', deepseekText);
        console.log('Gemini Response:', geminiText);

        // Construct prompt for Llama
        const llamaPrompt = `
Hello llama ai here i have generated responses from other ai can you combine these responses and generate me a response combined with all these responses with out saying at the beginning for example "Sure i will combine these responses.." e.t.c just the combined response nothing else here is the responses from other ai's

responses:
GPT-4.5-preview: ${gptText}
DeepSeek R1: ${deepseekText}
Gemini-1.5-pro: ${geminiText}
`;

        // Call Meta-Llama-3.1-405B-Instruct-Turbo
        const llamaResponse = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
            model: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
            messages: [{ role: 'user', content: llamaPrompt }],
            max_tokens: 512,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${llamaApiKey}`,
                'Content-Type': 'application/json'
            }
        }).catch(err => {
            console.error('Llama Error:', err.response?.data || err.message);
            return { data: { choices: [{ message: { content: 'Llama failed to combine responses. Original query: ' + message } }] } };
        });

        const finalAnswer = llamaResponse.data.choices?.[0]?.message?.content || 'No valid response from Llama';
        console.log('Final Llama Response:', finalAnswer);
        res.json({ answer: finalAnswer });
    } catch (error) {
        handleError(error, res);
    }
});

// Existing /upload endpoint (unchanged)
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileContent = req.file.buffer.toString('utf8');
    const prompt = req.body.prompt || 'Analyze this file';
    const message = `${prompt}\n\nFile content:\n${fileContent.substring(0, 1000)}...`;

    const aimlApiKey = process.env.LLAMA_API_KEY; // Using Llama key for consistency
    if (!aimlApiKey) {
        return res.status(500).json({ error: 'Server configuration error: AI/ML API key missing' });
    }

    try {
        const response = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
            model: 'o1-preview',
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
