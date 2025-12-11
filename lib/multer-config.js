const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/"))
      return cb(null, true);
    const err = new Error("Uploaded file is not an image");
    err.code = "NOT_IMAGE";
    cb(err);
  },
});

module.exports = upload;
