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
    const aimlApiKey = process.env.AIML_API_KEY;
    if (!aimlApiKey) {
        console.error('AIML_API_KEY is not set in environment variables');
        return res.status(500).json({ error: 'Server configuration error: AI/ML API key missing' });
    }

    try {
        console.log('Making request to AI/ML API...');
        const response = await axios.post('https://api.aimlapi.com/v1/chat/completions', {
            model: 'meta-llama/Llama-3-8b-chat-hf', // Updated to a valid model from the error options
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000, // Limit response length
            temperature: 0.7, // Control creativity
        }, {
            headers: {
                'Authorization': `Bearer ${aimlApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // Log the full API response for debugging
        console.log('AI/ML API response:', JSON.stringify(response.data, null, 2));

        // Extract the response content
        const answer = response.data.choices[0].message.content;
        res.json({ answer });
    } catch (error) {
        if (error.response) {
            console.error('AI/ML API error:', JSON.stringify(error.response.data, null, 2));
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
            const errorMsg = error.response.data.error?.message || 'Error generating response from AI/ML API';
            // Check for 403/429 errors related to usage limits
            if (error.response.status === 403 || error.response.status === 429) {
                res.status(error.response.status).json({
                    error: 'AI/ML API usage limit reached or access denied. Check your free tier limits at https://aimlapi.com/app/keys.'
                });
            } else {
                res.status(error.response.status).json({ error: errorMsg });
            }
        } else if (error.request) {
            console.error('No response received from AI/ML API:', error.request);
            res.status(500).json({ error: 'No response from AI/ML API. Check network connectivity.' });
        } else {
            console.error('Error setting up AI/ML API request:', error.message);
            res.status(500).json({ error: 'Error setting up request: ' + error.message });
        }
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
