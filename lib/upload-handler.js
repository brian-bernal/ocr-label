/**
 * Create upload middleware with error handling
 */
function createUploadMiddleware(upload) {
  return (req, res, next) => {
    upload.single("imageFile")(req, res, (err) => {
      // Handle multer file upload errors
      if (err instanceof require("multer").MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            reason: "Image file is too large. Please select a smaller image.",
          });
        }
        return res.status(400).json({
          success: false,
          reason: "File upload error. Please try again.",
        });
      }
      if (err) {
        return res.status(400).json({
          success: false,
          reason: "File upload error. Please try again.",
        });
      }
      next();
    });
  };
}

module.exports = { createUploadMiddleware };
