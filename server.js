const express = require("express");
const path = require("path");

require("dotenv").config();

const upload = require("./lib/multer-config");
const { createUploadMiddleware } = require("./lib/upload-handler");
const { processOcrResponse } = require("./lib/upload-processor");

const app = express();
const port = process.env.PORT || 80;

// POST /upload - file upload and label verification
app.post(
  "/upload",
  createUploadMiddleware(upload),
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          reason: "Please select an image file to upload.",
        });
      }
      await processOcrResponse(req, res);
    } catch (err) {
      if (err && err.code === "NOT_IMAGE") {
        return res.status(400).json({
          success: false,
          reason: "Uploaded file is not an image",
        });
      }
      console.error(
        "Unexpected error in /upload:",
        err && err.stack ? err.stack : err
      );
      res.status(500).json({
        success: false,
        reason: "Internal server error",
      });
    }
  }
);

// Error handler middleware
app.use((err, req, res, next) => {
  if (err instanceof require("multer").MulterError) {
    return res.status(400).json({
      success: false,
      reason: "File upload error. Please try again.",
    });
  }
  console.error("Unexpected error:", err && err.stack ? err.stack : err);
  res.status(500).json({
    success: false,
    reason: "Server error. Please try again.",
  });
});

// Static files and index.html
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).send("index.html not found");
  });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
