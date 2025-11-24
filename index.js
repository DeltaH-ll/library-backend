const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// 加载.env环境变量（必须在使用环境变量前执行）
dotenv.config();

// 导入数据库连接测试
const { testDbConnection } = require('./db');

// 导入路由（对应routes文件夹）
const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');
const borrowRoutes = require('./routes/borrow');
const usersRoutes = require('./routes/users');
const statsRoutes = require('./routes/stats');

// 导入中间件（对应middlewares文件夹）
const { authMiddleware, adminOnly } = require('./middlewares/auth');

// 初始化Express
const app = express();
const PORT = process.env.PORT || 3000;


// -------------------------- 全局中间件 --------------------------
// 跨域配置（允许前端访问）
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 解析JSON请求体
app.use(express.json());
// 解析表单数据
app.use(express.urlencoded({ extended: true }));

// 静态资源托管（uploads文件夹，用于访问图书封面）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// -------------------------- 路由配置 --------------------------
// 1. 无需登录的接口（认证相关）
app.use('/api/auth', authRoutes);

// 2. 需要登录的接口（统一验证token）
app.use('/api/books', authMiddleware, booksRoutes);    // 图书相关
app.use('/api/borrow', authMiddleware, borrowRoutes);  // 借阅相关
app.use('/api/users', authMiddleware, usersRoutes);    // 用户管理（管理员接口在路由内通过adminOnly控制）
app.use('/api/stats', authMiddleware, adminOnly, statsRoutes); // 管理员仪表盘统计


// -------------------------- 错误处理 --------------------------
app.use((err, req, res, next) => {
  console.error('服务器错误:', err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || '服务器内部错误',
    // 开发环境显示错误详情
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});


// -------------------------- 启动服务 --------------------------
// 先测试数据库连接，再启动服务器
testDbConnection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 服务器已启动，端口: ${PORT}`);
      console.log(`📌 接口根地址: http://localhost:${PORT}/api`);
      console.log(`📦 数据库: ${process.env.DB_NAME}`);
    });
  })
  .catch((error) => {
    console.error('❌ 数据库连接失败，服务器无法启动');
    console.error('错误详情:', error.message);
    console.error('\n💡 请检查：');
    console.error('   1. MySQL 服务是否正在运行');
    console.error('   2. .env 文件中的数据库配置是否正确');
    console.error('   3. 数据库是否存在（zx_rise_booksystem）');
    console.error('\n   运行诊断工具: node diagnose_db_issue.js');
    process.exit(1);
  });

module.exports = app;