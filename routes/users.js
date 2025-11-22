const express = require("express");
const router = express.Router();
const usersController = require("../controllers/usersController");
const upload = require("../middlewares/upload");
const { adminOnly } = require("../middlewares/auth");

router.get("/me/profile", usersController.profile);
router.put(
  "/me/profile",
  upload.single("avatar"),
  usersController.updateProfile
);
router.put("/me/password", usersController.changePassword);

router.get("/", adminOnly, usersController.list);
router.post("/", adminOnly, usersController.create);
router.put("/:id", adminOnly, upload.single("avatar"), usersController.update);
router.patch("/:id/status", adminOnly, usersController.updateStatus);
router.post("/:id/reset-password", adminOnly, usersController.resetPassword);
router.delete("/:id", adminOnly, usersController.remove);

module.exports = router;
