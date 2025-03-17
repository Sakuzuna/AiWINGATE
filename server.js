const express = require('express');
const axios = require('axios');
require('dotenv').config();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// API endpoint to handle prompt generation
app.post('/generate', async (req, res) => {
    const prompt = req.body.prompt;

    try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat', // Use DeepSeek-V3 (deepseek-chat)
            messages: [{ role: 'user', content: prompt }],
            stream: false
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Extract the response content from DeepSeek's API response
        const answer = response.data.choices[0].message.content;
        res.json({ answer });
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.response?.data?.error_msg || 'Error generating response' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
