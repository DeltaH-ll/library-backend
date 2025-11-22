// node/middlewares/auth.js
const jwt = require("jsonwebtoken");
require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";

exports.authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "未提供 token" });
  const parts = header.split(" ");
  if (parts.length !== 2)
    return res.status(401).json({ error: "Token 格式错误" });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: "无效或过期的 token" });
  }
};

exports.adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin")
    return res.status(403).json({ error: "需要管理员权限" });
  next();
};
