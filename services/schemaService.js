const db = require("../db");

let userColumnsEnsured = false;
let bookColumnsEnsured = false;
let borrowColumnsEnsured = false;
let passwordSupportsHash = true;

const requiredUserColumns = [
  {
    name: "email",
    sql: "ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER password",
  },
  {
    name: "student_id",
    sql: "ALTER TABLE users ADD COLUMN student_id VARCHAR(64) NULL AFTER email",
  },
  {
    name: "avatar_url",
    sql: "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL AFTER student_id",
  },
  {
    name: "status",
    sql: "ALTER TABLE users ADD COLUMN status ENUM('active','inactive') NOT NULL DEFAULT 'active' AFTER role",
  },
];

const requiredBookColumns = [
  {
    name: "publisher",
    sql: "ALTER TABLE books ADD COLUMN publisher VARCHAR(255) NULL AFTER author",
  },
];

const resolveDbName = async () => {
  if (process.env.DB_NAME) return process.env.DB_NAME;
  try {
    const [rows] = await db.query("SELECT DATABASE() AS db");
    const name = rows?.[0]?.db;
    return name || null;
  } catch (err) {
    console.warn("⚠️ 无法自动获取当前数据库名称：", err.message);
    return null;
  }
};

const ensureUserProfileColumns = async () => {
  if (userColumnsEnsured) return;

  const dbName = await resolveDbName();
  if (!dbName) {
    console.warn("⚠️ 未能确定数据库名称，跳过 users 表列检查");
    userColumnsEnsured = true;
    return;
  }

  try {
    const [columns] = await db.query(
      `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [dbName]
    );
    const columnMap = new Map(
      columns.map((col) => [col.COLUMN_NAME, col.CHARACTER_MAXIMUM_LENGTH])
    );

    for (const column of requiredUserColumns) {
      if (!columnMap.has(column.name)) {
        try {
          await db.query(column.sql);
          console.log(`ℹ️ 已自动补齐 users.${column.name} 列`);
        } catch (err) {
          console.warn(
            `⚠️ 创建 users.${column.name} 列失败：${err.message}`
          );
        }
      }
    }

    passwordSupportsHash = (columnMap.get("password") || 0) >= 80;
    if (!passwordSupportsHash) {
      try {
        await db.query(
          "ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NOT NULL"
        );
        passwordSupportsHash = true;
        console.log("ℹ️ 已自动将 users.password 扩展为 VARCHAR(255)");
      } catch (err) {
        console.warn(
          `⚠️ 扩展 users.password 列失败：${err.message}，将以明文存储新密码`
        );
      }
    }
  } catch (error) {
    console.warn("⚠️ 检查 users 表结构失败：", error.message);
  } finally {
    userColumnsEnsured = true;
  }
};

const ensureBookOptionalColumns = async () => {
  if (bookColumnsEnsured) return;

  const dbName = await resolveDbName();
  if (!dbName) {
    console.warn("⚠️ 未能确定数据库名称，跳过 books 表列检查");
    bookColumnsEnsured = true;
    return;
  }

  try {
    const [columns] = await db.query(
      `SELECT COLUMN_NAME, EXTRA, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'books'`,
      [dbName]
    );
    const existing = new Set(columns.map((col) => col.COLUMN_NAME));
    const columnMap = new Map(
      columns.map((col) => [col.COLUMN_NAME, col])
    );

    for (const column of requiredBookColumns) {
      if (!existing.has(column.name)) {
        try {
          await db.query(column.sql);
          console.log(`ℹ️ 已自动补齐 books.${column.name} 列`);
        } catch (err) {
          console.warn(
            `⚠️ 创建 books.${column.name} 列失败：${err.message}`
          );
        }
      }
    }

    // 检查并修复 books.id 是否为 AUTO_INCREMENT
    const idColumn = columnMap.get("id");
    if (idColumn && !/auto_increment/i.test(idColumn.EXTRA || "")) {
      const columnType = idColumn.COLUMN_TYPE || "INT";
      try {
        await db.query(
          `ALTER TABLE books MODIFY COLUMN id ${columnType} NOT NULL AUTO_INCREMENT`
        );
        console.log("ℹ️ 已为 books.id 启用 AUTO_INCREMENT");
      } catch (err) {
        console.warn(
          `⚠️ 调整 books.id 为 AUTO_INCREMENT 失败：${err.message}`
        );
      }
    }
  } catch (error) {
    console.warn("⚠️ 检查 books 表结构失败：", error.message);
  } finally {
    bookColumnsEnsured = true;
  }
};

const ensureBorrowTableColumns = async () => {
  const dbName = await resolveDbName();
  if (!dbName) {
    console.warn("⚠️ 未能确定数据库名称，跳过 borrow 表列检查");
    return;
  }

  try {
    const [columns] = await db.query(
      `SELECT COLUMN_NAME, IS_NULLABLE, EXTRA, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'borrow'`,
      [dbName]
    );
    const columnMap = new Map(
      columns.map((col) => [col.COLUMN_NAME, col])
    );

    // 修复 return_date 列
    const returnDate = columnMap.get("return_date");
    if (returnDate && returnDate.IS_NULLABLE !== "YES") {
      try {
        // 先清理非法日期值
        await db.query(
          "UPDATE borrow SET return_date = NULL WHERE return_date = '' OR return_date = '0000-00-00 00:00:00'"
        );
        await db.query(
          "ALTER TABLE borrow MODIFY COLUMN return_date DATETIME NULL DEFAULT NULL"
        );
        console.log("ℹ️ 已允许 borrow.return_date 为空");
      } catch (err) {
        console.warn(
          `⚠️ 调整 borrow.return_date 失败：${err.message}`
        );
      }
    }

    // 修复 id 列的 AUTO_INCREMENT
    const idColumn = columnMap.get("id");
    let idFixed = false;
    if (idColumn) {
      const isAutoIncrement = /auto_increment/i.test(idColumn.EXTRA || "");
      if (!isAutoIncrement) {
        const columnType = idColumn.COLUMN_TYPE || "INT";
        try {
          await db.query(
            `ALTER TABLE borrow MODIFY COLUMN id ${columnType} NOT NULL AUTO_INCREMENT`
          );
          console.log("ℹ️ 已为 borrow.id 启用 AUTO_INCREMENT");
          idFixed = true;
        } catch (err) {
          console.error(
            `❌ 调整 borrow.id 为 AUTO_INCREMENT 失败：${err.message}`
          );
          console.error("⚠️ 请手动执行以下SQL修复：");
          console.error(`   ALTER TABLE borrow MODIFY COLUMN id ${columnType} NOT NULL AUTO_INCREMENT;`);
          // 不抛出错误，允许继续，但会在后续操作中失败
        }
      } else {
        idFixed = true; // 已经是 AUTO_INCREMENT
      }
    } else {
      console.warn("⚠️ borrow 表缺少 id 列");
    }

    // 只有所有检查都通过后才设置标志
    if (idFixed && !borrowColumnsEnsured) {
      borrowColumnsEnsured = true;
    }
  } catch (error) {
    console.error("⚠️ 检查 borrow 表结构失败：", error.message);
    // 不设置标志，允许下次重试
  }
};

const canStorePasswordHash = () => passwordSupportsHash;

module.exports = {
  ensureUserProfileColumns,
  ensureBookOptionalColumns,
  ensureBorrowTableColumns,
  canStorePasswordHash,
};
