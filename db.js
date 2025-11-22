const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "library",
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  charset: "utf8mb4",
  dateStrings: true,
  timezone: "+08:00",
};

const pool = mysql.createPool(dbConfig);
const promisePool = pool.promise();

const testDbConnection = async () => {
  try {
    const connection = await promisePool.getConnection();
    console.log(
      `✅ 数据库连接成功：${dbConfig.user}@${dbConfig.host}/${dbConfig.database}`
    );
    connection.release();
  } catch (error) {
    console.error("❌ 数据库连接失败：", error.message);
    throw error;
  }
};

const query = (sql, params = []) => {
  return promisePool.query(sql, params);
};

const getConnection = () => promisePool.getConnection();

const transaction = async (handler) => {
  const connection = await promisePool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  pool: promisePool,
  rawPool: pool,
  query,
  getConnection,
  transaction,
  testDbConnection,
};
