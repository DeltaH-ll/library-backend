const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");

router.get("/overview", statsController.overview);

module.exports = router;

