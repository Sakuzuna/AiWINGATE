const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs'); // Add file system module
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

// Function to log IP address to ip.txt
const logIpAddress = (ip) => {
    const ipFilePath = path.join(__dirname, 'ip.txt');
    const logEntry = `${new Date().toISOString()} - ${ip}\n`;

    // Append the IP to the file
    fs.appendFile(ipFilePath, logEntry, (err) => {
        if (err) {
            console.error('Error writing to ip.txt:', err);
        } else {
            console.log(`Logged IP: ${ip}`);
        }
    });
};

app.get('/', (req, res) => {
    // Get the client's IP address
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logIpAddress(clientIp); // Log the IP
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.post('/generate', async (req, res) => {
    console.log('Received body:', req.body);
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
            messages: [
                {
                    role: 'user',
                    content: message
                }
            ],
            max_tokens: 512,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${aimlApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('API Response:', response.data);

        const answer = response.data.choices?.[0]?.message?.content || response.data.answer || response.data.response || 'No valid response';
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
            messages: [
                {
                    role: 'user',
                    content: message
                }
            ],
            max_tokens: 512,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${aimlApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('API Response:', response.data);

        const answer = response.data.choices?.[0]?.message?.content || response.data.answer || response.data.response || 'No valid response';
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
