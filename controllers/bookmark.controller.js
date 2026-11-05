
const mongoose = require("mongoose");
const axios = require("axios");
const cheerio = require("cheerio");

const Bookmark = require("../models/bookmark.model");
const validateUrl = require("../utils/urlSecurity");

// Escape special characters in search input
const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Fetch website title and meta description safely
const fetchMetadata = async (initialUrl) => {
  let currentUrl = initialUrl;
  const maxRedirects = 5;

  try {
    for (let i = 0; i <= maxRedirects; i++) {
      // Validate every URL, including redirect destinations
      const safeUrl = await validateUrl(currentUrl);

      const response = await axios.get(safeUrl.href, {
        timeout: 8000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        responseType: "text",
        validateStatus: () => true,
        headers: {
          "User-Agent": "LinkVault/1.0",
          Accept: "text/html",
        },
      });

      // Handle redirects manually
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;

        if (!location) {
          return { title: "", description: "" };
        }

        if (i === maxRedirects) {
          throw new Error("Too many redirects");
        }

        currentUrl = new URL(location, safeUrl).href;
        continue;
      }

      // Only read HTML responses
      const contentType = response.headers["content-type"] || "";

      if (
        response.status < 200 ||
        response.status >= 300 ||
        !contentType.toLowerCase().includes("text/html")
      ) {
        return { title: "", description: "" };
      }

      const $ = cheerio.load(response.data);

      const title = $("title").first().text().trim();

      const description =
        $('meta[name="description"]').attr("content")?.trim() ||
        $('meta[property="og:description"]').attr("content")?.trim() ||
        "";

      return {
        title,
        description,
      };
    }
  } catch (error) {
    // Metadata failure should not prevent saving a valid bookmark
    console.log("Metadata fetching failed:", error.message);
  }

  return {
    title: "",
    description: "",
  };
};

// Create Bookmark
const createBookmark = async (req, res) => {
  try {
    const { url, title, description, tags, notes } = req.body;

    // Validate required URL
    if (typeof url !== "string" || !url.trim()) {
      return res.status(400).json({
        success: false,
        message: "URL is required",
      });
    }

    // SSRF and URL validation
    let parsedUrl;

    try {
      parsedUrl = await validateUrl(url.trim());
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    // Validate request fields
    if (title !== undefined && typeof title !== "string") {
      return res.status(400).json({
        success: false,
        message: "Title must be a string",
      });
    }

    if (
      description !== undefined &&
      typeof description !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must be a string",
      });
    }

    if (
      notes !== undefined &&
      typeof notes !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Notes must be a string",
      });
    }

    if (
      tags !== undefined &&
      (!Array.isArray(tags) ||
        !tags.every((tag) => typeof tag === "string"))
    ) {
      return res.status(400).json({
        success: false,
        message: "Tags must be an array of strings",
      });
    }

    // Check duplicate URL
    const existingBookmark = await Bookmark.findOne({
      url: parsedUrl.href,
    });

    if (existingBookmark) {
      return res.status(409).json({
        success: false,
        message: "Bookmark already exists",
      });
    }

    // Automatically fetch website metadata
    const metadata = await fetchMetadata(parsedUrl.href);

    // Save bookmark
    const bookmark = await Bookmark.create({
      url: parsedUrl.href,
      title: title?.trim() || metadata.title,
      description: description?.trim() || metadata.description,
      tags: tags || [],
      notes: notes || "",
    });

    return res.status(201).json({
      success: true,
      message: "Bookmark created successfully",
      data: bookmark,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Bookmark already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get All Bookmarks
const getBookmarks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      tag = "",
      sort = "desc",
    } = req.query;

    // Pagination
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageLimit = Math.min(
      100,
      Math.max(1, parseInt(limit, 10) || 10)
    );

    const skip = (currentPage - 1) * pageLimit;

    // Search query
    const query = {};

    if (search.trim()) {
      const escapedSearch = escapeRegex(search.trim());

      query.$or = [
        { title: { $regex: escapedSearch, $options: "i" } },
        { tags: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    // Tag filter
    if (tag.trim()) {
      query.tags = {
        $regex: `^${escapeRegex(tag.trim())}$`,
        $options: "i",
      };
    }

    // Sorting
    const sortOrder = sort === "asc" ? 1 : -1;

    const bookmarks = await Bookmark.find(query)
      .sort({ createdAt: sortOrder, _id: sortOrder })
      .skip(skip)
      .limit(pageLimit);

    const totalBookmarks = await Bookmark.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: bookmarks,
      pagination: {
        currentPage,
        pageLimit,
        totalBookmarks,
        totalPages: Math.ceil(totalBookmarks / pageLimit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bookmarks",
      error: error.message,
    });
  }
};

// Update Bookmark
const updateBookmark = async (req, res) => {
  try {
    const { id } = req.params;
    const { url, title, description, tags, notes } = req.body;

    // Validate MongoDB ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bookmark ID",
      });
    }

    const bookmark = await Bookmark.findById(id);

    if (!bookmark) {
      return res.status(404).json({
        success: false,
        message: "Bookmark not found",
      });
    }

    // Validate URL if provided
    if (url !== undefined) {
      let parsedUrl;

      try {
        parsedUrl = await validateUrl(url);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      // Check duplicate URL
      const existingBookmark = await Bookmark.findOne({
        url: parsedUrl.href,
        _id: { $ne: id },
      });

      if (existingBookmark) {
        return res.status(409).json({
          success: false,
          message: "Bookmark URL already exists",
        });
      }

      bookmark.url = parsedUrl.href;
    }

    // Validate other fields
    if (title !== undefined) {
      if (typeof title !== "string") {
        return res.status(400).json({
          success: false,
          message: "Title must be a string",
        });
      }

      bookmark.title = title;
    }

    if (description !== undefined) {
      if (typeof description !== "string") {
        return res.status(400).json({
          success: false,
          message: "Description must be a string",
        });
      }

      bookmark.description = description;
    }

    if (tags !== undefined) {
      if (
        !Array.isArray(tags) ||
        !tags.every((tag) => typeof tag === "string")
      ) {
        return res.status(400).json({
          success: false,
          message: "Tags must be an array of strings",
        });
      }

      bookmark.tags = tags;
    }

    if (notes !== undefined) {
      if (typeof notes !== "string") {
        return res.status(400).json({
          success: false,
          message: "Notes must be a string",
        });
      }

      bookmark.notes = notes;
    }

    await bookmark.save();

    return res.status(200).json({
      success: true,
      message: "Bookmark updated successfully",
      data: bookmark,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Bookmark URL already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update bookmark",
      error: error.message,
    });
  }
};

// Delete Bookmark
const deleteBookmark = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bookmark ID",
      });
    }

    const deletedBookmark = await Bookmark.findByIdAndDelete(id);

    if (!deletedBookmark) {
      return res.status(404).json({
        success: false,
        message: "Bookmark not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Bookmark deleted successfully",
      data: deletedBookmark,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete bookmark",
      error: error.message,
    });
  }
};

// Get Bookmark By ID
const getBookmarkById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bookmark ID",
      });
    }

    const bookmark = await Bookmark.findById(id);

    if (!bookmark) {
      return res.status(404).json({
        success: false,
        message: "Bookmark not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: bookmark,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bookmark",
      error: error.message,
    });
  }
};

module.exports = {
  createBookmark,
  getBookmarks,
  updateBookmark,
  deleteBookmark,
  getBookmarkById,
};
