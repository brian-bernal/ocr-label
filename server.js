const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

/**
 * server.js
 *
 * Node.js backend that accepts image uploads at POST /upload, forwards the image
 * to an external API (with retries on timeout), captures the JSON response as a string,
 * and verifies that supplied strings are present in that JSON. Replies with success/failure
 * and reasoning.
 *
 * Environment variables:
 *  - PORT (default 80)
 *  - EXTERNAL_API_KEY (required)
 *
 * Dependencies: express, multer, axios, form-data, dotenv
 *
 * Install:
 *   npm install express multer axios form-data dotenv
 *
 */

require('dotenv').config();

const app = express();
const port = process.env.PORT || 80

// OCR.space endpoint
const EXTERNAL_API_URL = 'https://api.ocr.space/parse/image';

// API key in environment variable on the server
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;

// OCR engine to request from the external API
const EXTERNAL_OCR_ENGINE = '2';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // 1s, then exponential

// multer memory storage to keep files in RAM
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize:  1 * 1024 * 1024 }, // 1MB limit
    fileFilter: (req, file, cb) => {
        // Basic check: mime type should be image/*
        if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
        const err = new Error('Uploaded file is not an image');
        err.code = 'NOT_IMAGE';
        cb(err);
    },
});

// helper to build array of required strings from body param
function parseRequiredStrings(raw) {
    if (!raw) return [];
    // if client sent JSON array (as string) or comma-separated list
    if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
    } catch (e) {
        // ignore
    }
    // fallback: comma-separated
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

// retryable post to external API with timeout awareness
async function postToExternalApi(fileBuffer, filename, mimetype) {
    let attempt = 0;
    let lastErr = null;
    const axiosTimeout = 60_000; // 1 minute timeout as specified

    while (attempt < MAX_RETRIES) {
        attempt += 1;
        try {
            const form = new FormData();
            form.append('file', fileBuffer, { filename, contentType: mimetype });

            const headers = {
                ...form.getHeaders(),
            };
            
            // For OCR.space, include API key as a form field and also optionally as a header.
            if (EXTERNAL_API_KEY) {
                headers['apikey'] = EXTERNAL_API_KEY;
            }

            // Include OCR engine selection (e.g. 2) as requested
            if (EXTERNAL_OCR_ENGINE) {
                form.append('OCREngine', EXTERNAL_OCR_ENGINE);
            }

            const resp = await axios.post(EXTERNAL_API_URL, form, {
                headers,
                timeout: axiosTimeout,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                validateStatus: null, // we'll handle statuses ourselves
            });

            // If external API returned a non-JSON or status error, we still return resp to caller for analysis
            return { success: true, response: resp, attempts: attempt };
        } catch (err) {
            lastErr = err;
            // timeout errors from axios set code === 'ECONNABORTED'
            const isTimeout = err.code === 'ECONNABORTED';
            // network/server errors may have no response
            const isServerErr = err.response && err.response.status >= 500;
            if (isTimeout || isServerErr) {
                // retryable
                const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
                await new Promise(r => setTimeout(r, backoff));
                continue;
            }
            // other errors (4xx, bad request etc.) are not retried
            break;
        }
    }

    return { success: false, error: lastErr, attempts: attempt };
}

app.post('/upload', (req, res, next) => {
    upload.single('imageFile')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, reason: 'Image file is too large. Please select a smaller image.' });
            }
            return res.status(400).json({ success: false, reason: 'File upload error. Please try again.' });
        }
        if (err) {
            return res.status(400).json({ success: false, reason: 'File upload error. Please try again.' });
        }
        next();
    });
}, express.urlencoded({ extended: true }), async (req, res) => {
    try {
        // multer will have put the file in req.file
        if (!req.file) {
            return res.status(400).json({ success: false, reason: 'Please select an image file to upload.' });
        }

        // parse required strings from body param 'required' (can be JSON array or comma-separated) or 'strings'
        const rawRequired = req.body.required ?? req.body.strings ?? req.body.q;
        // capture submitted form fields from the frontend
        const brandName = req.body.brandName ?? null;
        const productClass = req.body.productClass ?? null;
        const alcoholContent = req.body.alcoholContent ?? null;
        const requiredStrings = parseRequiredStrings(rawRequired);

        // optional case sensitivity flag (default false)
        const caseSensitive = req.body.caseSensitive === 'true' || req.body.caseSensitive === '1';

        // call external API with retries on timeout
        const result = await postToExternalApi(req.file.buffer, req.file.originalname, req.file.mimetype);

        if (!result.success) {
            const err = result.error;
            // Distinguish timeout vs other error messages
            const isTimeout = err && err.code === 'ECONNABORTED';
            const msg = isTimeout ? 'External API timed out' : `Failed to call external API: ${err && err.message}`;
            return res.status(502).json({
                success: false,
                reason: msg,
                attempts: result.attempts,
            });
        }

        const resp = result.response;
        const attempts = result.attempts;

        // If external API returned non-2xx, include its status and body for reasoning
        if (!resp || resp.status < 200 || resp.status >= 300) {
            // try to extract error code from body if available
            let body = resp && resp.data;
            let codeFromApi = null;
            if (body && typeof body === 'object') {
                codeFromApi = body.error_code ?? body.code ?? body.error?.code ?? null;
            }
            return res.status(502).json({
                success: false,
                reason: 'External API returned an error status',
                apiStatus: resp ? resp.status : null,
                apiErrorCode: codeFromApi,
                attempts,
                apiBody: body,
            });
        }

        // success from external API; capture JSON as string
        const apiData = resp.data;
        let jsonString;
        try {
            jsonString = typeof apiData === 'string' ? apiData : JSON.stringify(apiData);
        } catch (e) {
            // fallback
            jsonString = String(apiData);
        }

        // Extract parsed text from common OCR API response shapes (OCR.space)
        let parsedText = '';
        try {
            if (apiData) {
                if (Array.isArray(apiData.ParsedResults) && apiData.ParsedResults.length > 0) {
                    parsedText = apiData.ParsedResults.map(p => (p && p.ParsedText) ? p.ParsedText : '').join('\n');
                } else if (typeof apiData.ParsedText === 'string') {
                    parsedText = apiData.ParsedText;
                } else if (typeof apiData === 'string') {
                    parsedText = apiData;
                } else {
                    // fallback to JSON string
                    parsedText = jsonString;
                }
            }
        } catch (e) {
            parsedText = jsonString;
        }

        // Normalize function for safer comparisons
        const normalize = s => (s || '').toString().normalize('NFKD').replace(/\s+/g, ' ').trim().toLowerCase();

        // Label verification: check that submitted fields appear in parsedText
        const labelChecks = { found: [], missing: [] };
        const normalizedParsed = normalize(parsedText);

        if (brandName) {
            const n = normalize(brandName);
            if (n && normalizedParsed.includes(n)) labelChecks.found.push('brandName');
            else labelChecks.missing.push('brandName');
        }

        if (productClass) {
            const n = normalize(productClass);
            if (n && normalizedParsed.includes(n)) labelChecks.found.push('productClass');
            else labelChecks.missing.push('productClass');
        }

        if (alcoholContent) {
            const raw = alcoholContent.toString().trim();
            // try numeric matching first
            const numeric = parseFloat(raw);
            let alcoholFound = false;
            if (!Number.isNaN(numeric)) {
                // match exact numeric token with optional % / percent / abv suffix
                const token = String(numeric).replace('.', '\\.');
                const re = new RegExp('\\b' + token + '(?:\\.0)?\\s*(?:%|percent|abv)', 'i');
                alcoholFound = re.test(parsedText);
            }
            
            if (alcoholFound) labelChecks.found.push('alcoholContent');
            else labelChecks.missing.push('alcoholContent');
        }

        // If all submitted fields are present, return a successful label verification response
        if (labelChecks.missing.length === 0 && labelChecks.found.length > 0) {
            return res.status(200).json({
                success: true,
                reason: 'Label verification successful',
                attempts,
                submittedFields: { brandName, productClass, alcoholContent },
                labelChecks,
            });
        }

        // Check for explicit error codes in external API JSON
        const apiErrorCode = (apiData && (apiData.error_code || apiData.code || apiData.error?.code)) || null;
        if (apiErrorCode) {
            // External API indicated some application-level error
            return res.status(400).json({
                success: false,
                reason: 'External API returned an error code in payload',
                apiErrorCode,
                attempts,
            });
        }

        // If no required strings provided, respond with label verification results
        if (requiredStrings.length === 0) {
            const verificationPassed = labelChecks.missing.length === 0 && labelChecks.found.length > 0;
            return res.status(200).json({
                success: verificationPassed,
                attempts,
                apiRawString: jsonString,
                parsedText: parsedText,
                normalizedParsed: normalizedParsed,
                submittedFields: { brandName, productClass, alcoholContent },
                labelChecks,
                verificationPassed,
            });
        }

        // perform presence checks (case-insensitive by default)
        const haystack = caseSensitive ? jsonString : jsonString.toLowerCase();
        const missing = [];
        const found = [];

        for (const s of requiredStrings) {
            const needle = caseSensitive ? s : s.toLowerCase();
            if (haystack.includes(needle)) {
                found.push(s);
            } else {
                missing.push(s);
            }
        }

        if (missing.length === 0) {
            return res.status(200).json({
                success: true,
                reason: 'All required strings found in external API JSON response',
                attempts,
                found,
            });
        } else {
            return res.status(400).json({
                success: false,
                reason: 'Some required strings were not found in external API JSON response',
                attempts,
                missing,
                found,
            });
        }
    } catch (err) {
        // multer-specific image rejection
        if (err && err.code === 'NOT_IMAGE') {
            return res.status(400).json({ success: false, reason: 'Uploaded file is not an image' });
        }
        console.error('Unexpected error in /upload:', err && err.stack ? err.stack : err);
        return res.status(500).json({ success: false, reason: 'Internal server error' });
    }
});

// Error handler middleware for multer and other errors
app.use((err, req, res, next) => {
    // Other multer errors
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, reason: 'File upload error. Please try again.' });
    }
    // Generic error
    console.error('Unexpected error:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, reason: 'Server error. Please try again.' });
});

// Serve other static assets from the same directory
app.use(express.static(__dirname));

// root: serve index.html if present, otherwise 404
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    res.status(404).send('index.html not found');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
