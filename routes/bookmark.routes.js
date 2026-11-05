const express = require("express");

const router = express.Router();

const {
  createBookmark,
  getBookmarks,
  updateBookmark,
  deleteBookmark,
  getBookmarkById,
} = require("../controllers/bookmark.controller");

router.post("/", createBookmark);
router.get("/", getBookmarks);
// router.put("/:id", updateBookmark);
router.patch("/:id", updateBookmark);
router.delete("/:id", deleteBookmark);
router.get("/:id", getBookmarkById);


module.exports = router;