const {
  postToExternalApi,
} = require("./ocr-service");
const {
  extractParsedText,
  verifyLabels,
  isVerificationComplete,
} = require("./label-verifier");

/**
 * Extract form fields and configuration from request
 */
function extractRequestData(req) {
  return {
    brandName: req.body.brandName ?? null,
    productClass: req.body.productClass ?? null,
    alcoholContent: req.body.alcoholContent ?? null,
  };
}

/**
 * Stringify API response data
 */
function stringifyApiData(apiData) {
  try {
    return typeof apiData === "string" ? apiData : JSON.stringify(apiData);
  } catch (e) {
    return String(apiData);
  }
}

/**
 * Process OCR API response and verify labels
 */
async function processOcrResponse(req, res) {
  const requestData = extractRequestData(req);

  const result = await postToExternalApi(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype
  );

  if (!result.success) {
    const isTimeout = result.error && result.error.code === "ECONNABORTED";
    const msg = isTimeout
      ? "External API timed out"
      : `Failed to call external API: ${result.error && result.error.message}`;
    return res.status(502).json({
      success: false,
      reason: msg,
      attempts: result.attempts,
    });
  }

  const { response: resp, attempts } = result;

  if (!resp || resp.status < 200 || resp.status >= 300) {
    const body = resp && resp.data;
    const exitCode = body && typeof body === "object" ? body.OCRExitCode : null;
    return res.status(502).json({
      success: false,
      reason: "External API returned an error status",
      apiStatus: resp ? resp.status : null,
      apiErrorCode: exitCode,
      attempts,
      apiBody: body,
    });
  }

  const jsonString = stringifyApiData(resp.data);
  const parsedText = extractParsedText(resp.data, jsonString);

  // Check for API error codes (OCRExitCode 1-2 = success, others = error)
  const exitCode = resp.data && typeof resp.data === "object" ? resp.data.OCRExitCode : null;
  if (exitCode && exitCode !== 1 && exitCode !== 2) {
    return res.status(400).json({
      success: false,
      reason: "External API returned an error code in payload",
      apiErrorCode: exitCode,
      attempts,
    });
  }

  const labelChecks = verifyLabels(parsedText, {
    brandName: requestData.brandName,
    productClass: requestData.productClass,
    alcoholContent: requestData.alcoholContent,
  });

  // Return label verification results (always 200 since request was processed successfully)
  return res.status(200).json({
    success: isVerificationComplete(labelChecks),
    reason: isVerificationComplete(labelChecks)
      ? "All labels verified successfully"
      : "Could not find required labels in image",
    attempts,
    submittedFields: {
      brandName: requestData.brandName,
      productClass: requestData.productClass,
      alcoholContent: requestData.alcoholContent,
    },
    labelChecks,
  });
}

module.exports = { processOcrResponse };
