const axios = require("axios");
const FormData = require("form-data");

/**
 * OCR Service Module
 * Handles communication with external OCR API (OCR.space)
 */

// Configuration from environment
const EXTERNAL_API_URL =
  process.env.EXTERNAL_API_URL || "https://api.ocr.space/parse/image";
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;
const EXTERNAL_OCR_ENGINE = process.env.EXTERNAL_OCR_ENGINE || "2";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // 1s, then exponential

/**
 * Post image to external OCR API with retries on timeout
 * @param {Buffer} fileBuffer - Image file buffer
 * @param {string} filename - Original filename
 * @param {string} mimetype - MIME type (e.g., 'image/jpeg')
 * @returns {Promise<{success: boolean, response?: object, error?: Error, attempts: number}>}
 */
async function postToExternalApi(fileBuffer, filename, mimetype) {
  let attempt = 0;
  let lastErr = null;
  const axiosTimeout = 60_000; // 1 minute timeout

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      const form = new FormData();
      form.append("file", fileBuffer, { filename, contentType: mimetype });

      const headers = {
        ...form.getHeaders(),
      };

      // Include API key if provided
      if (EXTERNAL_API_KEY) {
        headers["apikey"] = EXTERNAL_API_KEY;
      }

      // Include OCR engine selection
      if (EXTERNAL_OCR_ENGINE) {
        form.append("OCREngine", EXTERNAL_OCR_ENGINE);
      }

      const resp = await axios.post(EXTERNAL_API_URL, form, {
        headers,
        timeout: axiosTimeout,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: null, // we'll handle statuses ourselves
      });

      return { success: true, response: resp, attempts: attempt };
    } catch (err) {
      lastErr = err;
      // timeout errors from axios set code === 'ECONNABORTED'
      const isTimeout = err.code === "ECONNABORTED";
      // network/server errors may have no response
      const isServerErr = err.response && err.response.status >= 500;
      if (isTimeout || isServerErr) {
        // retryable
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      // other errors (4xx, bad request etc.) are not retried
      break;
    }
  }

  return { success: false, error: lastErr, attempts: attempt };
}

module.exports = {
  postToExternalApi,
};
