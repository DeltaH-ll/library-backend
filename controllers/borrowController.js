const db = require("../db");
const { ensureBorrowTableColumns } = require("../services/schemaService");

exports.list = async (req, res) => {
  try {
    await ensureBorrowTableColumns();
    const page = Math.max(1, Math.min(100, parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 6));
    const offset = (page - 1) * limit;

    const keyword = (req.query.keyword || req.query.q || "").trim();
    const status = (req.query.status || "").trim();
    const requestUserId = req.query.user_id || req.query.userId;

    const where = [];
    const params = [];

    if (req.user?.role !== "admin") {
      where.push("b.user_id = ?");
      params.push(req.user.id);
    } else if (requestUserId) {
      where.push("b.user_id = ?");
      params.push(requestUserId);
    }

    if (keyword) {
      where.push(
        "(books.title LIKE ? OR users.username LIKE ? OR users.student_id LIKE ? OR users.email LIKE ?)"
      );
      params.push(
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`
      );
    }

    if (status) {
      where.push("b.status = ?");
      params.push(status);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[countResult]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM borrow b
       JOIN books ON b.book_id = books.id
       JOIN users ON b.user_id = users.id
       ${whereClause}`,
      params
    );
    const total = countResult?.total || 0;

    const [rows] = await db.query(
      `SELECT b.id, b.book_id, books.title AS book_title, books.author AS book_author,
              books.price AS book_price, books.cover_url,
              b.user_id, users.username, users.student_id AS studentId,
              users.email, b.borrow_date, b.return_date, b.status
       FROM borrow b
       JOIN books ON b.book_id = books.id
       JOIN users ON b.user_id = users.id
       ${whereClause}
       ORDER BY b.borrow_date ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("借阅记录查询失败:", error);
    res.status(500).json({ success: false, error: "查询借阅记录失败" });
  }
};

exports.create = async (req, res) => {
  try {
    await ensureBorrowTableColumns();
    const requestedUserId = req.body.user_id;
    const bookId = req.body.book_id;

    if (!bookId) {
      return res
        .status(400)
        .json({ success: false, error: "图书ID为必填项" });
    }

    let userId = req.user?.id;
    if (req.user?.role === "admin" && requestedUserId) {
      userId = requestedUserId;
    }

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, error: "无法识别借阅用户" });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [bookRows] = await connection.query(
        "SELECT available_count FROM books WHERE id = ? FOR UPDATE",
        [bookId]
      );

      if (!bookRows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: "图书不存在" });
      }

      const available = bookRows[0].available_count;
      if (available <= 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: "该书库存不足" });
      }

      const [insertResult] = await connection.query(
        "INSERT INTO borrow (book_id, user_id, borrow_date, status) VALUES (?, ?, NOW(), '借出')",
        [bookId, userId]
      );

      const newAvailable = available - 1;

      await connection.query(
        "UPDATE books SET available_count = ?, status = ? WHERE id = ?",
        [newAvailable, newAvailable > 0 ? "在馆" : "已借出", bookId]
      );

      await connection.commit();
      res
        .status(201)
        .json({ success: true, borrowId: insertResult.insertId || null });
    } catch (transactionErr) {
      await connection.rollback();
      throw transactionErr;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("借书操作失败:", error);
    res.status(500).json({ success: false, error: "借书失败，请稍后重试" });
  }
};

exports.return = async (req, res) => {
  try {
    await ensureBorrowTableColumns();
    const borrowId = req.params.id;
    if (!borrowId || Number.isNaN(Number(borrowId))) {
      return res.status(400).json({ success: false, error: "借阅记录ID无效" });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [borrowRows] = await connection.query(
        "SELECT id, book_id, status FROM borrow WHERE id = ? FOR UPDATE",
        [borrowId]
      );

      if (!borrowRows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: "借阅记录不存在" });
      }

      const record = borrowRows[0];
      if (record.status === "已还") {
        await connection.rollback();
        return res.status(400).json({ success: false, error: "该记录已归还" });
      }

      await connection.query(
        "UPDATE borrow SET return_date = NOW(), status = '已还' WHERE id = ?",
        [borrowId]
      );

      const [bookRows] = await connection.query(
        "SELECT available_count, total_count FROM books WHERE id = ? FOR UPDATE",
        [record.book_id]
      );
      if (!bookRows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: "图书不存在" });
      }

      const { available_count, total_count } = bookRows[0];
      const newAvailable = Math.min(available_count + 1, total_count);

      await connection.query(
        "UPDATE books SET available_count = ?, status = ? WHERE id = ?",
        [newAvailable, newAvailable > 0 ? "在馆" : "已借出", record.book_id]
      );

      await connection.commit();
      res.json({ success: true, message: "还书成功" });
    } catch (transactionErr) {
      await connection.rollback();
      throw transactionErr;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("还书操作失败:", error);
    res.status(500).json({ success: false, error: "还书失败，请稍后重试" });
  }
};

exports.remove = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await ensureBorrowTableColumns();
    const borrowId = req.params.id;
    if (!borrowId || Number.isNaN(Number(borrowId))) {
      return res.status(400).json({ success: false, error: "借阅记录ID无效" });
    }

    await connection.beginTransaction();

    // 查询借阅记录信息
    const [borrowRows] = await connection.query(
      "SELECT id, book_id, status FROM borrow WHERE id = ? FOR UPDATE",
      [borrowId]
    );

    if (!borrowRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: "借阅记录不存在" });
    }

    const record = borrowRows[0];
    let needUpdateBook = false;

    // 如果记录状态是"借出"，删除时需要归还图书
    if (record.status === "借出") {
      needUpdateBook = true;
    }

    // 删除借阅记录
    await connection.query("DELETE FROM borrow WHERE id = ?", [borrowId]);

    // 如果需要，更新图书可用数量
    if (needUpdateBook) {
      const [bookRows] = await connection.query(
        "SELECT available_count, total_count FROM books WHERE id = ? FOR UPDATE",
        [record.book_id]
      );
      if (bookRows.length) {
        const { available_count, total_count } = bookRows[0];
        const newAvailable = Math.min(available_count + 1, total_count);
        await connection.query(
          "UPDATE books SET available_count = ?, status = ? WHERE id = ?",
          [newAvailable, newAvailable > 0 ? "在馆" : "已借出", record.book_id]
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: "借阅记录已删除" });
  } catch (error) {
    await connection.rollback();
    console.error("删除借阅记录失败:", error);
    res.status(500).json({ success: false, error: "删除借阅记录失败" });
  } finally {
    connection.release();
  }
};
