const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/db");
const bookmarkRoutes = require("./routes/bookmark.routes");

const app = express();

app.use(cors());
app.use(express.json());

// Main Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Link Vault API is running",
  });
});

// Bookmark Routes
app.use("/api/bookmarks", bookmarkRoutes);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();