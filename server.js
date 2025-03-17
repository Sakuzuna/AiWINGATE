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
    const grokApiKey = process.env.GROK_API_KEY;
    if (!grokApiKey) {
        console.error('GROK_API_KEY is not set in environment variables');
        return res.status(500).json({ error: 'Server configuration error: Grok API key missing' });
    }

    try {
        console.log('Making request to xAI Grok API...');
        const response = await axios.post('https://api.x.ai/v1/chat/completions', {
            model: 'grok-3', // Try grok-3 (released Feb 2025, likely available); fallback to grok-beta if needed
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000, // Optional: limit response length
            temperature: 0.7, // Optional: control creativity
        }, {
            headers: {
                'Authorization': `Bearer ${grokApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // Log the full API response for debugging
        console.log('Grok API response:', JSON.stringify(response.data, null, 2));

        // Extract the response content
        const answer = response.data.choices[0].message.content;
        res.json({ answer });
    } catch (error) {
        // Log the error details
        if (error.response) {
            console.error('Grok API error:', JSON.stringify(error.response.data, null, 2));
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
            res.status(error.response.status).json({
                error: error.response.data.error_msg || 'Error generating response from Grok API'
            });
        } else if (error.request) {
            console.error('No response received from Grok API:', error.request);
            res.status(500).json({ error: 'No response from Grok API. Check network connectivity.' });
        } else {
            console.error('Error setting up Grok API request:', error.message);
            res.status(500).json({ error: 'Error setting up request: ' + error.message });
        }
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
