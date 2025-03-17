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

    // Log the incoming prompt for debugging
    console.log('Received prompt:', prompt);

    // Check if the API key is available
    if (!process.env.DEEPSK_API_KEY) {
        console.error('DEEPSK_API_KEY is not set in environment variables');
        return res.status(500).json({ error: 'Server configuration error: API key missing' });
    }

    try {
        console.log('Making request to DeepSeek API...');
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat', // DeepSeek-V3 (general-purpose chat model)
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000, // Optional: limit response length
            temperature: 0.7, // Optional: control creativity
            stream: false
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Log the full API response for debugging
        console.log('DeepSeek API response:', JSON.stringify(response.data, null, 2));

        // Extract the response content
        const answer = response.data.choices[0].message.content;
        res.json({ answer });
    } catch (error) {
        // Log the error details
        if (error.response) {
            console.error('DeepSeek API error:', JSON.stringify(error.response.data, null, 2));
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
            res.status(error.response.status).json({
                error: error.response.data.error_msg || 'Error generating response from DeepSeek API'
            });
        } else if (error.request) {
            console.error('No response received from DeepSeek API:', error.request);
            res.status(500).json({ error: 'No response from DeepSeek API. Check network connectivity.' });
        } else {
            console.error('Error setting up DeepSeek API request:', error.message);
            res.status(500).json({ error: 'Error setting up request: ' + error.message });
        }
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
