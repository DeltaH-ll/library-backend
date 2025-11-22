const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!file.mimetype?.startsWith("image/")) {
    return cb(new Error("仅支持图片上传"));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Number(process.env.UPLOAD_MAX_SIZE || 2 * 1024 * 1024),
  },
});

module.exports = upload;
