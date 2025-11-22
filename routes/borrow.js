// node/routes/borrow.js
const express = require("express");
const router = express.Router();
const borrowCtrl = require("../controllers/borrowController");

router.get("/", borrowCtrl.list);

router.post("/", borrowCtrl.create);
router.put("/:id/return", borrowCtrl.return);
router.delete("/:id", borrowCtrl.remove);

module.exports = router;
