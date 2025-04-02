require('dotenv').config();
const express = require('express');
const cors = require('cors');
const llmService = require('./services/llm');
const storageService = require('./services/storage');
const emailService = require('./services/email');
const app = express();
const path = require('path');
app.use(express.static(path.join(__dirname, '../public')));
// Enable CORS for the client app
// TODO: enable only our domain for origin, so that we don't expose our API to anyone else
app.use(cors({
    origin: 'https://bonjour.lapartdesamis.fr',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));
// Parse JSON bodies
app.use(express.json());

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Handle form submissions
app.post('/submit', async (req, res) => {
    console.log('****************************'); 
    console.log('Received form submission:');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('****************************');
    
    try {
        const llmResult = await llmService.processFormSubmission(req.body);
        if (llmResult.success) {
            const response = { 
                message: 'Form data processed successfully',
                selection: llmResult.selection
            };

            console.log('****************************'); 
            console.log('Wines selected in catalog:', llmResult.selection.length);
            // Store form data and LLM selection in Supabase
            const { data, error } = await storageService.storeFormSubmission(req.body, llmResult.selection);
            
            if (error) {
                console.error('Error storing form data:', error);
                // Continue with the response even if storage fails
            } else {
                console.log('****************************'); 
                console.log('Form data stored successfully:', data);
                response.submissionId = data[0].id; // Add the submission ID to the response
                
                // Send email notification to owners
                try {
                    console.log('****************************'); 
                    console.log('Sending an email notification to LPDA owners');
                    await emailService.sendSubmissionNotification(req.body, llmResult.selection);
                } catch (emailError) {
                    console.error('Error sending email notification:', emailError);
                    // Continue with the response even if email notification fails
                }

                // send results to client if identified with Email
                if (req.body.Email) {
                    try {
                    console.log('****************************');
                    console.log('Sending results to client email directly');
                    await emailService.sendWineSelection(req.body.Email, data[0].id);
                    }
                    catch (emailError) {
                        console.error('Error sending results to client email:', emailError);
                        // Continue with the response even if email notification fails
                    }
                }
            }
            
            res.json(response);
        } else {
            res.status(504).json({ 
                error: 'Timeout', 
                message: 'Le serveur est actuellement occupé à traiter des requêtes. Veuillez réessayer dans quelques minutes.'
            });
        }
    } catch (error) {
        console.error('Error processing form submission:', error);
        // Check if it's a timeout error
        if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
            res.status(504).json({ 
                error: 'Gateway Timeout', 
                message: 'Le serveur est actuellement occupé à traiter des requêtes. Veuillez réessayer dans quelques minutes.'
            });
        } else {
            res.status(500).json({ error: 'Failed to process form submission' });
        }
    }
});

// Get wine selection by submission ID
app.get('/selection/:submissionId', async (req, res) => {
    console.log('****************************'); 
    console.log('Get submission ID:');
    console.log(req.params);
    console.log('****************************'); 
    try {
        const { submissionId } = req.params;
        const { data, error } = await storageService.getWineSelection(submissionId);
        
        if (error) {
            console.error('Error fetching wine selection:', error);
            return res.status(500).json({ error: 'Failed to fetch wine selection' });
        }
        
        res.json(data);
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Send wine selection to customer email
app.post('/send-email', async (req, res) => {
    console.log('****************************'); 
    console.log('Sending wine selection to customer email:');
    console.log(req.body);
    console.log('****************************');
    
    try {
        const { email, submissionId } = req.body;
        
        if (!email || !submissionId) {
            return res.status(400).json({ error: 'Email and submissionId are required' });
        }
        
        const { data, error } = await emailService.sendWineSelection(email, submissionId);
        
        if (error) {
            console.error('Error sending wine selection email:', error);
            return res.status(500).json({ error: 'Failed to send wine selection email' });
        }

        console.log('****************************');
        console.log('Updating submission with client email');
        const { data: updateData, error: updateError } = await storageService.updateSubmissionWithClientEmail(submissionId, email);

        if (updateError) {
            console.error('Error updating submission with client email:', updateError);
            return res.status(500).json({ error: 'Failed to update submission with client email' });
        }
        console.log('****************************');
        console.log('Submission updated with client email:', updateData);
        
        res.json({ message: 'Wine selection email sent successfully' });
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Fallback to index.html for SPA-like behavior
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server running');
});