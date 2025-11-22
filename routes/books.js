// node/routes/books.js
const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload"); 
const booksCtrl = require("../controllers/booksController");
const { adminOnly } = require("../middlewares/auth");

router.get("/", booksCtrl.list);
router.get("/:id", booksCtrl.detail);
router.post(
  "/",
  adminOnly,
  upload.single("cover"),
  booksCtrl.create
);
router.put(
  "/:id",
  adminOnly,
  upload.single("cover"),
  booksCtrl.update
);
router.delete("/:id", adminOnly, booksCtrl.remove);

module.exports = router;
