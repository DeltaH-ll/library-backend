const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const upload = require("../middlewares/upload");

// 注册接口（无需认证）
router.post("/register", upload.single("avatar"), authController.register);

// 登录接口（无需认证）
router.post("/login", authController.login);

module.exports = router;
