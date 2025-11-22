const { Client } = require("minio");
const path = require("path");
const fs = require("fs");

const useMinio = Boolean(process.env.MINIO_ENDPOINT);
const bucket = process.env.MINIO_BUCKET || "library";
const minioPort = Number(process.env.MINIO_PORT || 9000);
const minioUseSSL = (process.env.MINIO_USE_SSL || "false") === "true";
const minioPublicBase = (process.env.MINIO_PUBLIC_URL || "").replace(/\/$/, "");
const uploadsRoot = path.join(__dirname, "..", "uploads");

let minioClient = null;
let bucketReady = false;

if (useMinio) {
  minioClient = new Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: minioPort,
    useSSL: minioUseSSL,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
  });
}

const ensureBucket = async () => {
  if (!useMinio || bucketReady) return;
  const exists = await minioClient
    .bucketExists(bucket)
    .catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(bucket);
  }
  bucketReady = true;
};

const buildObjectKey = (folder = "misc", originalName = "file") => {
  const safeFolder = folder.replace(/^\//, "").replace(/\/$/, "");
  const ext = path.extname(originalName) || ".jpg";
  const basename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  return `${safeFolder}/${basename}`;
};

const ensureDirectory = (dirPath) => {
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      fs.unlinkSync(dirPath);
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      fs.mkdirSync(dirPath, { recursive: true });
    } else if (err.code === "ENOTDIR") {
      fs.unlinkSync(dirPath);
      fs.mkdirSync(dirPath, { recursive: true });
    } else {
      throw err;
    }
  }
};

const saveImage = async (file, folder = "misc") => {
  if (!file || !file.buffer) return null;
  const objectKey = buildObjectKey(folder, file.originalname);

  if (useMinio) {
    await ensureBucket();
    await minioClient.putObject(bucket, objectKey, file.buffer, {
      "Content-Type": file.mimetype || "application/octet-stream",
    });

    const baseUrl =
      minioPublicBase ||
      `${minioUseSSL ? "https" : "http"}://${process.env.MINIO_ENDPOINT}${
        minioPort ? `:${minioPort}` : ""
      }/${bucket}`;

    return {
      url: `${baseUrl.replace(/\/$/, "")}/${objectKey}`,
      objectKey,
      driver: "minio",
    };
  }

  // 确保 uploads 根目录存在（使用更健壮的方式）
  ensureDirectory(uploadsRoot);

  // 确保子目录存在
  const targetDir = path.join(uploadsRoot, folder);
  ensureDirectory(targetDir);
  
  const filename = path.basename(objectKey);
  const targetPath = path.join(targetDir, filename);
  fs.writeFileSync(targetPath, file.buffer);

  return {
    url: `/uploads/${folder}/${filename}`,
    objectKey: `${folder}/${filename}`,
    driver: "local",
  };
};

const removeByUrl = async (url = "") => {
  if (!url) return;

  if (useMinio && url.includes(bucket)) {
    const base =
      minioPublicBase ||
      `${minioUseSSL ? "https" : "http"}://${process.env.MINIO_ENDPOINT}${
        minioPort ? `:${minioPort}` : ""
      }/${bucket}`;
    const objectKey = url.replace(`${base.replace(/\/$/, "")}/`, "");
    if (objectKey) {
      try {
        await ensureBucket();
        await minioClient.removeObject(bucket, objectKey);
      } catch (err) {
        console.warn("移除 MinIO 对象失败:", err.message);
      }
    }
    return;
  }

  if (url.startsWith("/uploads")) {
    const relative = url.replace(/^\/?uploads\//, "");
    const targetPath = path.join(uploadsRoot, relative);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }
};

module.exports = {
  saveImage,
  removeByUrl,
};

