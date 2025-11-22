const db = require("../db");
const storage = require("../services/storageService");
const { ensureBookOptionalColumns } = require("../services/schemaService");

const wrapTitle = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let inner = raw;
  if (inner.startsWith("《")) {
    inner = inner.slice(1);
  }
  if (inner.endsWith("》")) {
    inner = inner.slice(0, -1);
  }
  inner = inner.trim();
  return inner ? `《${inner}》` : "";
};

const buildFilters = (query = {}) => {
  const where = [];
  const params = [];

  const keyword = (query.keyword || query.q || query.search || "").trim();
  if (keyword) {
    where.push("(title LIKE ? OR author LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const status = query.status;
  if (status && ["在馆", "已借出", "下架"].includes(status)) {
    where.push("status = ?");
    params.push(status);
  }

  const hasValue = (value) =>
    value !== undefined && value !== null && String(value).trim() !== "";

  if (hasValue(query.minPrice)) {
    const minPrice = Number(query.minPrice);
    if (!Number.isNaN(minPrice)) {
      where.push("price >= ?");
      params.push(minPrice);
    }
  }

  if (hasValue(query.maxPrice)) {
    const maxPrice = Number(query.maxPrice);
    if (!Number.isNaN(maxPrice)) {
      where.push("price <= ?");
      params.push(maxPrice);
    }
  }

  return { where, params };
};

exports.list = async (req, res) => {
  try {
    await ensureBookOptionalColumns();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 6)
    );
    const offset = (page - 1) * limit;

    const { where, params } = buildFilters(req.query);
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[countResult]] = await db.query(
      `SELECT COUNT(*) AS total FROM books ${whereClause}`,
      params
    );
    const total = countResult?.total || 0;

    const [rows] = await db.query(
      `SELECT id, title, author, publisher, publish_date, 
              total_count, available_count, status, cover_url, price
       FROM books
       ${whereClause}
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: rows,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("获取图书列表失败:", error);
    res.status(500).json({ success: false, error: "获取图书列表失败" });
  }
};

exports.detail = async (req, res) => {
  try {
    await ensureBookOptionalColumns();
    const bookId = req.params.id;
    const [rows] = await db.query(
      `SELECT id, title, author, publisher, publish_date, 
              total_count, available_count, status, cover_url, price
       FROM books WHERE id = ? LIMIT 1`,
      [bookId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "图书不存在" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("获取图书详情失败:", error);
    res.status(500).json({ success: false, error: "获取图书详情失败" });
  }
};

exports.create = async (req, res) => {
  try {
    await ensureBookOptionalColumns();
    
    // FormData 数据可能以字符串形式传递，需要正确解析
    const {
      title,
      author,
      publisher,
      publish_date,
      total_count,
      available_count,
      price,
    } = req.body || {};

    // 验证必填字段（FormData 中的值可能是字符串）
    const titleStr = title ? String(title).trim() : '';
    const authorStr = author ? String(author).trim() : '';
    
    const normalizedTitle = wrapTitle(titleStr);
    if (!normalizedTitle) {
      return res
        .status(400)
        .json({ success: false, error: "标题为必填项且不能为空" });
    }
    if (!authorStr) {
      return res
        .status(400)
        .json({ success: false, error: "作者为必填项且不能为空" });
    }

    // 验证数量（FormData 中的数字可能是字符串）
    const parsedTotal = Number(total_count);
    if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "总数量必须大于 0" });
    }
    const total = parsedTotal;

    const parsedAvailable = Number(
      available_count !== undefined && available_count !== '' ? available_count : total
    );
    const available = Number.isFinite(parsedAvailable)
      ? Math.min(Math.max(parsedAvailable, 0), total)
      : total;

    // 处理封面图片
    let coverUrl = null;
    if (req.file) {
      try {
        const saved = await storage.saveImage(req.file, "books");
        coverUrl = saved?.url || null;
      } catch (fileError) {
        console.error("保存封面图片失败:", fileError);
        return res.status(500).json({ 
          success: false, 
          error: `保存封面图片失败: ${fileError.message}` 
        });
      }
    }

    const status = available > 0 ? "在馆" : "已借出";
    
    // 处理价格（FormData 中的价格可能是字符串）
    const parsedPrice = price ? Number(price) : 0;
    const finalPrice = Number.isFinite(parsedPrice) ? parsedPrice : 0;

    // 执行数据库插入
    const [result] = await db.query(
      `INSERT INTO books (
        title, author, publisher, publish_date,
        total_count, available_count, status, cover_url,
        price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedTitle,
        authorStr,
        publisher ? String(publisher).trim() : null,
        publish_date || null,
        total,
        available,
        status,
        coverUrl,
        finalPrice,
      ]
    );

    res.status(201).json({
      success: true,
      bookId: result.insertId || null,
    });
  } catch (error) {
    console.error("创建图书失败:", error);
    console.error("错误详情:", {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sql: error.sql,
      stack: error.stack
    });
    const errorMessage = error.message || "创建图书失败";
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        sqlState: error.sqlState,
        sql: error.sql
      } : undefined
    });
  }
};

exports.update = async (req, res) => {
  try {
    await ensureBookOptionalColumns();
    const bookId = req.params.id;
    const [rows] = await db.query(
      `SELECT id, title, author, publisher, publish_date,
              cover_url, total_count, available_count, price
       FROM books WHERE id = ?`,
      [bookId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "图书不存在" });
    }

    const current = rows[0];
    const {
      title,
      author,
      publisher,
      publish_date,
      total_count,
      available_count,
      price,
    } = req.body || {};

    let coverUrl = current.cover_url;
    if (req.file) {
      if (coverUrl) {
        await storage.removeByUrl(coverUrl);
      }
      const saved = await storage.saveImage(req.file, "books");
      coverUrl = saved?.url || coverUrl;
    }

    const parsedTotal = Number(total_count);
    const total = Number.isFinite(parsedTotal) && parsedTotal > 0
      ? parsedTotal
      : current.total_count;

    const borrowedCount = Math.max(
      current.total_count - current.available_count,
      0
    );
    const minAvailable = Math.max(total - borrowedCount, 0);

    let available;
    if (available_count !== undefined) {
      const parsedAvailable = Number(available_count);
      available = Number.isFinite(parsedAvailable)
        ? parsedAvailable
        : current.available_count;
      available = Math.max(minAvailable, Math.min(total, available));
    } else {
      available = Math.min(total, minAvailable);
    }

    const status = available > 0 ? "在馆" : "已借出";

    const nextTitle = wrapTitle(title !== undefined ? title : current.title);
    const nextAuthor = author?.trim() || current.author;
    const nextPublisher = publisher?.trim() || current.publisher;
    const nextPublishDate =
      publish_date === undefined ? current.publish_date : publish_date || null;
    const parsedPrice =
      price === undefined || price === null
        ? current.price || 0
        : Number(price) || 0;

    await db.query(
      `UPDATE books SET
        title = ?, author = ?, publisher = ?, publish_date = ?,
        total_count = ?, available_count = ?, status = ?,
        cover_url = ?, price = ?
       WHERE id = ?`,
      [
        nextTitle,
        nextAuthor,
        nextPublisher || null,
        nextPublishDate,
        total,
        available,
        status,
        coverUrl,
        parsedPrice,
        bookId,
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("更新图书失败:", error);
    res.status(500).json({ success: false, error: "更新图书失败" });
  }
};

exports.remove = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await ensureBookOptionalColumns();
    const bookId = req.params.id;
    
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT cover_url FROM books WHERE id = ? FOR UPDATE",
      [bookId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: "图书不存在" });
    }
    const coverUrl = rows[0].cover_url;

    // 删除相关借阅记录
    await connection.query("DELETE FROM borrow WHERE book_id = ?", [bookId]);

    // 删除图书
    await connection.query("DELETE FROM books WHERE id = ?", [bookId]);

    await connection.commit();

    if (coverUrl) {
      await storage.removeByUrl(coverUrl);
    }

    res.json({ success: true, message: "图书已删除" });
  } catch (error) {
    await connection.rollback();
    console.error("删除图书失败:", error);
    res.status(500).json({ success: false, error: "删除图书失败" });
  } finally {
    connection.release();
  }
};
