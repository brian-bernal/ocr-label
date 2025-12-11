/**
 * Label Verifier Module
 * Handles extraction and verification of OCR text against submitted fields
 */

/**
 * Extract parsed text from OCR API response (handles multiple response shapes)
 * @param {object} apiData - Response data from OCR API
 * @param {string} jsonString - Fallback JSON string representation
 * @returns {string} Extracted parsed text
 */
function extractParsedText(apiData, jsonString) {
  try {
    if (apiData) {
      // OCR.space format with ParsedResults array
      if (
        Array.isArray(apiData.ParsedResults) &&
        apiData.ParsedResults.length > 0
      ) {
        return apiData.ParsedResults.map((p) =>
          p && p.ParsedText ? p.ParsedText : ""
        ).join("\n");
      }
      // Direct ParsedText field
      if (typeof apiData.ParsedText === "string") {
        return apiData.ParsedText;
      }
      // API returned a string directly
      if (typeof apiData === "string") {
        return apiData;
      }
      // Fallback to JSON string
      return jsonString;
    }
  } catch (e) {
    // On error, fallback to JSON string
  }
  return jsonString;
}

/**
 * Normalize string for case-insensitive, accent-insensitive comparison
 * @param {string} s - String to normalize
 * @returns {string} Normalized string
 */
function normalize(s) {
  return (s || "")
    .toString()
    .normalize("NFKD")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Verify that submitted fields appear in the parsed OCR text
 * @param {string} parsedText - Extracted OCR text
 * @param {object} fields - Fields to verify: { brandName, productClass, alcoholContent }
 * @returns {object} { found: [], missing: [] }
 */
function verifyLabels(parsedText, fields) {
  const labelChecks = { found: [], missing: [] };
  const normalizedParsed = normalize(parsedText);

  // Check brand name
  if (fields.brandName) {
    const n = normalize(fields.brandName);
    if (n && normalizedParsed.includes(n)) {
      labelChecks.found.push("brandName");
    } else {
      labelChecks.missing.push("brandName");
    }
  }

  // Check product class
  if (fields.productClass) {
    const n = normalize(fields.productClass);
    if (n && normalizedParsed.includes(n)) {
      labelChecks.found.push("productClass");
    } else {
      labelChecks.missing.push("productClass");
    }
  }

  // Check alcohol content (with special numeric matching)
  if (fields.alcoholContent) {
    const raw = fields.alcoholContent.toString().trim();
    const numeric = parseFloat(raw);
    let alcoholFound = false;

    if (!Number.isNaN(numeric)) {
      // Try to match numeric token with optional % / percent / abv suffix
      const token = String(numeric).replace(".", "\\.");
      const re = new RegExp(
        "\\b" + token + "(?:\\.0)?\\s*(?:%|percent|abv)",
        "i"
      );
      alcoholFound = re.test(parsedText);
    }

    if (alcoholFound) {
      labelChecks.found.push("alcoholContent");
    } else {
      labelChecks.missing.push("alcoholContent");
    }
  }

  return labelChecks;
}

/**
 * Check if all submitted fields were successfully verified
 * @param {object} labelChecks - Result from verifyLabels()
 * @returns {boolean} True if all fields found, false otherwise
 */
function isVerificationComplete(labelChecks) {
  return labelChecks.missing.length === 0 && labelChecks.found.length > 0;
}

module.exports = {
  extractParsedText,
  verifyLabels,
  isVerificationComplete,
};
