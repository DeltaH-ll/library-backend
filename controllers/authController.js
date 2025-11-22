const db = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const storage = require("../services/storageService");
const {
  ensureUserProfileColumns,
  canStorePasswordHash,
} = require("../services/schemaService");

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";

const mapUser = (user = {}) => ({
  id: user.id,
  username: user.username,
  role: user.role || "user",
  email: user.email || "",
  studentId: user.student_id || "",
  avatar: user.avatar_url || "",
});

exports.register = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const {
      username,
      password,
      role = "user",
      email,
      studentId,
      inviteCode,
    } = req.body || {};

    if (!username || !password || !email || !studentId) {
      return res.status(400).json({
        success: false,
        msg: "用户名、密码、邮箱、学号均为必填项",
      });
    }

    const normalizedRole = ["admin", "user"].includes(role) ? role : "user";
    
    // 如果注册为管理员，需要验证邀请码
    if (normalizedRole === "admin") {
      if (!inviteCode || inviteCode !== "123qwe") {
        return res.status(400).json({
          success: false,
          msg: "管理员邀请码不正确",
        });
      }
    }
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedStudentId = studentId.trim();

    const [userDup] = await db.query(
      "SELECT id FROM users WHERE username = ? LIMIT 1",
      [normalizedUsername]
    );
    if (userDup.length) {
      return res.status(400).json({ success: false, msg: "用户名已存在" });
    }

    const [emailDup] = await db.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );
    if (emailDup.length) {
      return res.status(400).json({ success: false, msg: "邮箱已被使用" });
    }

    const [studentDup] = await db.query(
      "SELECT id FROM users WHERE student_id = ? LIMIT 1",
      [normalizedStudentId]
    );
    if (studentDup.length) {
      return res.status(400).json({ success: false, msg: "学号已被使用" });
    }

    let avatarUrl = null;
    if (req.file) {
      try {
        const saved = await storage.saveImage(req.file, "avatars");
        avatarUrl = saved?.url || null;
      } catch (err) {
        console.warn("保存注册头像失败：", err.message);
      }
    }

    const passwordValue = canStorePasswordHash()
      ? await bcrypt.hash(password, 10)
      : password;
    const [result] = await db.query(
      `INSERT INTO users (username, password, role, email, student_id, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        normalizedUsername,
        passwordValue,
        normalizedRole,
        normalizedEmail,
        normalizedStudentId,
        avatarUrl,
      ]
    );

    return res.status(201).json({
      success: true,
      msg: "注册成功",
      user: {
        id: result.insertId,
        username: normalizedUsername,
        email: normalizedEmail,
        studentId: normalizedStudentId,
        avatar: avatarUrl,
        role: normalizedRole,
      },
    });
  } catch (error) {
    console.error("注册失败:", error);
    return res.status(500).json({ success: false, msg: "服务器错误，注册失败" });
  }
};

exports.login = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const { username, identifier, password } = req.body || {};
    const account = (identifier || username || "").trim();

    if (!account || !password) {
      return res.status(400).json({
        success: false,
        msg: "账号和密码不能为空",
      });
    }

    const [users] = await db.query(
      `SELECT id, username, password, role, email, student_id, avatar_url, status
       FROM users
       WHERE username = ? OR email = ? OR student_id = ?
       LIMIT 1`,
      [account, account, account]
    );

    if (!users.length) {
      return res.status(401).json({ success: false, msg: "用户名或密码错误" });
    }

    const user = users[0];
    
    // 检查用户状态
    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, msg: "账户已被禁用，无法登录" });
    }
    
    let passwordMatches = false;
    try {
      passwordMatches = await bcrypt.compare(password, user.password || "");
    } catch (err) {
      passwordMatches = false;
    }

    if (!passwordMatches && password !== user.password) {
      return res.status(401).json({ success: false, msg: "用户名或密码错误" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role || "user",
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
    );

    const safeUser = mapUser(user);

    return res.json({
      success: true,
      user: safeUser,
      token,
    });
  } catch (error) {
    console.error("登录失败:", error);
    return res.status(500).json({ success: false, msg: "服务器错误，登录失败" });
  }
};
