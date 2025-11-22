const db = require("../db");
const bcrypt = require("bcryptjs");
const storage = require("../services/storageService");
const {
  ensureUserProfileColumns,
  canStorePasswordHash,
} = require("../services/schemaService");

const normalizeStatus = (status) =>
  ["active", "inactive"].includes(status) ? status : "active";

const normalizeRole = (role) =>
  ["admin", "user"].includes(role) ? role : "user";

exports.list = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const keyword = (req.query.keyword || req.query.q || "").trim();
    const requestedRole = req.query.role;
    const status = req.query.status;

    const where = [];
    const params = [];

    if (keyword) {
      where.push(
        "(username LIKE ? OR email LIKE ? OR student_id LIKE ?)"
      );
      params.push(
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`
      );
    }

    if (["admin", "user"].includes(requestedRole)) {
      where.push("role = ?");
      params.push(normalizeRole(requestedRole));
    }

    if (status && ["active", "inactive"].includes(status)) {
      where.push("status = ?");
      params.push(status);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[countResult]] = await db.query(
      `SELECT COUNT(*) AS total FROM users ${whereClause}`,
      params
    );
    const total = countResult?.total || 0;

    const [rows] = await db.query(
      `SELECT id, username, role, email, student_id AS studentId,
              status, avatar_url AS avatar
       FROM users
       ${whereClause}
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error("查询用户列表失败:", error);
    res
      .status(500)
      .json({ success: false, error: "服务器错误，获取用户列表失败" });
  }
};

exports.create = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const {
      username,
      role = "user",
      password = "123456",
      email,
      studentId,
      status = "active",
    } = req.body || {};

    if (!username) {
      return res
        .status(400)
        .json({ success: false, error: "用户名不能为空" });
    }

    const [exists] = await db.query(
      "SELECT id FROM users WHERE username = ? LIMIT 1",
      [username.trim()]
    );
    if (exists.length) {
      return res.status(400).json({ success: false, error: "用户名已存在" });
    }

    const passwordValue = canStorePasswordHash()
      ? await bcrypt.hash(password, 10)
      : password;

    const [result] = await db.query(
      `INSERT INTO users (username, password, role, email, student_id, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        username.trim(),
        passwordValue,
        normalizeRole(role),
        email || null,
        studentId || null,
        normalizeStatus(status),
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        username,
        role: normalizeRole(role),
      },
    });
  } catch (error) {
    console.error("创建用户失败:", error);
    res.status(500).json({ success: false, error: "创建用户失败" });
  }
};

exports.update = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const userId = req.params.id;
    const { username, role, email, studentId, status } = req.body || {};

    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "用户不存在" });
    }

    let avatarUrl = rows[0].avatar_url;
    if (req.file) {
      if (avatarUrl) {
        await storage.removeByUrl(avatarUrl);
      }
      const saved = await storage.saveImage(req.file, "avatars");
      avatarUrl = saved?.url || avatarUrl;
    }

    await db.query(
      `UPDATE users SET
        username = ?, role = ?, email = ?, student_id = ?, status = ?, avatar_url = ?
       WHERE id = ?`,
      [
        username?.trim() || rows[0].username,
        role ? normalizeRole(role) : rows[0].role,
        email || rows[0].email || null,
        studentId || rows[0].student_id || null,
        status ? normalizeStatus(status) : rows[0].status,
        avatarUrl,
        userId,
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("更新用户失败:", error);
    res.status(500).json({ success: false, error: "更新用户失败" });
  }
};

exports.remove = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await ensureUserProfileColumns();
    const userId = req.params.id;
    if (Number(userId) === req.user?.id) {
      return res
        .status(400)
        .json({ success: false, error: "不能删除当前登录用户" });
    }

    await connection.beginTransaction();

    // 检查用户是否存在
    const [userRows] = await connection.query(
      "SELECT id, role FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );
    if (!userRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: "用户不存在" });
    }

    // 查找该用户所有未归还的借阅记录
    const [borrowRows] = await connection.query(
      `SELECT id, book_id FROM borrow 
       WHERE user_id = ? AND status = '借出'`,
      [userId]
    );

    // 自动归还该用户的所有未还书籍
    for (const borrowRecord of borrowRows) {
      // 更新借阅记录为已归还
      await connection.query(
        "UPDATE borrow SET return_date = NOW(), status = '已还' WHERE id = ?",
        [borrowRecord.id]
      );

      // 更新对应书籍的可用数量
      const [bookRows] = await connection.query(
        "SELECT available_count, total_count FROM books WHERE id = ? FOR UPDATE",
        [borrowRecord.book_id]
      );
      if (bookRows.length) {
        const { available_count, total_count } = bookRows[0];
        const newAvailable = Math.min(available_count + 1, total_count);
        await connection.query(
          "UPDATE books SET available_count = ?, status = ? WHERE id = ?",
          [
            newAvailable,
            newAvailable > 0 ? "在馆" : "已借出",
            borrowRecord.book_id,
          ]
        );
      }
    }

    // 删除用户
    await connection.query("DELETE FROM users WHERE id = ?", [userId]);

    await connection.commit();
    res.json({
      success: true,
      message: `用户已删除，已自动归还 ${borrowRows.length} 本未还书籍`,
    });
  } catch (error) {
    await connection.rollback();
    console.error("删除用户失败:", error);
    res.status(500).json({ success: false, error: "删除用户失败" });
  } finally {
    connection.release();
  }
};

exports.updateStatus = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const userId = req.params.id;
    const status = normalizeStatus(req.body.status);

    // 检查用户是否存在及其角色
    const [userRows] = await db.query(
      "SELECT id, role FROM users WHERE id = ?",
      [userId]
    );
    if (!userRows.length) {
      return res.status(404).json({ success: false, error: "用户不存在" });
    }
    
    // 如果是禁用管理员，给出警告但允许操作（管理员可以禁用其他管理员，但不能禁用自己）
    if (userRows[0].role === 'admin' && status === 'inactive') {
      if (Number(userId) === req.user?.id) {
        return res.status(400).json({ success: false, error: "不能禁用当前登录的管理员账户" });
      }
      // 允许禁用其他管理员，但会在前端显示警告
    }

    await db.query("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
    res.json({ success: true });
  } catch (error) {
    console.error("更新用户状态失败:", error);
    res.status(500).json({ success: false, error: "更新状态失败" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const userId = req.params.id;
    const newPassword = req.body.password || "123456";
    const passwordValue = canStorePasswordHash()
      ? await bcrypt.hash(newPassword, 10)
      : newPassword;
    await db.query("UPDATE users SET password = ? WHERE id = ?", [
      passwordValue,
      userId,
    ]);
    res.json({ success: true });
  } catch (error) {
    console.error("重置密码失败:", error);
    res.status(500).json({ success: false, error: "重置密码失败" });
  }
};

exports.profile = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT id, username, role, email, student_id AS studentId,
              status, avatar_url AS avatar
       FROM users WHERE id = ?`,
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "用户不存在" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("获取个人信息失败:", error);
    res.status(500).json({ success: false, error: "获取个人信息失败" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const userId = req.user.id;
    const { username, email, studentId } = req.body || {};

    const [rows] = await db.query(
      "SELECT username, email, student_id, avatar_url FROM users WHERE id = ?",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "用户不存在" });
    }

    let avatarUrl = rows[0].avatar_url;
    if (req.file) {
      if (avatarUrl) {
        await storage.removeByUrl(avatarUrl);
      }
      const saved = await storage.saveImage(req.file, "avatars");
      avatarUrl = saved?.url || avatarUrl;
    }

    const nextUsername = username?.trim() || rows[0].username;
    const nextEmail =
      email === undefined ? rows[0].email : email || null;
    const nextStudentId =
      studentId === undefined ? rows[0].student_id : studentId || null;

    await db.query(
      `UPDATE users SET username = ?, email = ?, student_id = ?, avatar_url = ?
       WHERE id = ?`,
      [nextUsername, nextEmail, nextStudentId, avatarUrl, userId]
    );

    res.json({
      success: true,
      data: {
        id: userId,
        username: nextUsername,
        email: nextEmail,
        studentId: nextStudentId,
        avatar: avatarUrl,
      },
    });
  } catch (error) {
    console.error("更新个人资料失败:", error);
    res.status(500).json({ success: false, error: "更新个人资料失败" });
  }
};

exports.changePassword = async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const userId = req.user.id;
    const { oldPassword, newPassword } = req.body || {};

    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ success: false, error: "旧密码和新密码不能为空" });
    }

    const [rows] = await db.query(
      "SELECT password FROM users WHERE id = ?",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "用户不存在" });
    }

    const current = rows[0].password || "";
    let valid = false;
    try {
      valid = await bcrypt.compare(oldPassword, current);
    } catch (err) {
      valid = false;
    }

    if (!valid && oldPassword !== current) {
      return res.status(400).json({ success: false, error: "旧密码不正确" });
    }

    const passwordValue = canStorePasswordHash()
      ? await bcrypt.hash(newPassword, 10)
      : newPassword;
    await db.query("UPDATE users SET password = ? WHERE id = ?", [
      passwordValue,
      userId,
    ]);

    res.json({ success: true, message: "密码更新成功" });
  } catch (error) {
    console.error("修改密码失败:", error);
    res.status(500).json({ success: false, error: "修改密码失败" });
  }
};
