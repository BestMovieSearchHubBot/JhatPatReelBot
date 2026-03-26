const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");

// ========================
//  ENVIRONMENT CHECK
// ========================
const BOT_TOKEN = process.env.BOT_TOKEN;
const RAPID_API_KEY = process.env.RAPID_API_KEY;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !RAPID_API_KEY) {
  console.error("❌ Missing environment variables: BOT_TOKEN and RAPID_API_KEY are required.");
  process.exit(1);
}

// ========================
//  EXPRESS SERVER
// ========================
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is running"));
app.listen(PORT, () => console.log(`Express server running on port ${PORT}`));

// ========================
//  TELEGRAM BOT
// ========================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========================
//  UTILITY FUNCTIONS
// ========================

function cleanLink(link) {
  return link.split("?")[0];
}

/**
 * Tries to extract media URLs from any API response
 */
function extractMediaUrls(data) {
  const urls = [];

  const addUrl = (val) => {
    if (val && typeof val === "string" && (val.startsWith("http") || val.startsWith("https"))) {
      urls.push(val);
    }
  };

  const processArray = (arr) => {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === "string") addUrl(item);
        else if (item.url) addUrl(item.url);
        else if (item.video) addUrl(item.video);
        else if (item.image) addUrl(item.image);
      }
    }
  };

  const fields = ["video", "video_url", "url", "media", "image", "images", "carousel_media", "videos"];
  for (const field of fields) {
    const val = data[field];
    if (val) {
      if (typeof val === "string") addUrl(val);
      else if (Array.isArray(val)) processArray(val);
      else if (typeof val === "object" && val.url) addUrl(val.url);
    }
  }

  if (data.data && typeof data.data === "object") {
    const nestedUrls = extractMediaUrls(data.data);
    urls.push(...nestedUrls);
  }

  if (Array.isArray(data)) {
    processArray(data);
  }

  return [...new Set(urls)];
}

async function downloadInstagramMedia(url) {
  try {
    const response = await axios.get(
      "https://instagram-reels-downloader-api.p.rapidapi.com/download",
      {
        params: { url },
        headers: {
          "x-rapidapi-key": RAPID_API_KEY,
          "x-rapidapi-host": "instagram-reels-downloader-api.p.rapidapi.com",
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    console.log("=== API Response for", url, "===");
    console.log(JSON.stringify(response.data, null, 2));
    console.log("=================================");

    if (response.data.status && response.data.status !== "ok") {
      throw new Error(`API returned status "${response.data.status}": ${response.data.message || "No details"}`);
    }

    const mediaUrls = extractMediaUrls(response.data);
    console.log("Extracted media URLs:", mediaUrls);

    if (mediaUrls.length === 0) {
      console.error("No URLs extracted. Raw response:", response.data);
      throw new Error("No media URLs found in API response. Check the link or API.");
    }

    return mediaUrls.length === 1 ? mediaUrls[0] : mediaUrls;
  } catch (error) {
    console.error("Download API error:", error.message);
    if (error.response) {
      console.error("API response data:", error.response.data);
    }
    throw new Error("Failed to fetch media from Instagram. Please check the link.");
  }
}

async function sendMedia(chatId, mediaUrl, type) {
  try {
    // Try to check file size via HEAD request (optional, may fail)
    try {
      const headRes = await axios.head(mediaUrl, { timeout: 5000 });
      const contentLength = parseInt(headRes.headers['content-length']);
      if (!isNaN(contentLength)) {
        const sizeMB = contentLength / (1024 * 1024);
        const maxSizeMB = (type === 'video') ? 50 : 20;
        if (sizeMB > maxSizeMB) {
          await bot.sendMessage(chatId, `⚠️ File is ${sizeMB.toFixed(1)} MB, which exceeds Telegram's limit of ${maxSizeMB} MB for ${type}s.\nYou can download it directly: ${mediaUrl}`);
          return;
        }
      }
    } catch (headErr) {
      // HEAD request may fail, continue anyway
      console.log("HEAD request failed:", headErr.message);
    }

    if (type === "video") {
      await bot.sendVideo(chatId, mediaUrl, { caption: "✅ Video downloaded" });
    } else if (type === "image") {
      await bot.sendPhoto(chatId, mediaUrl, { caption: "✅ Image downloaded" });
    } else {
      await bot.sendDocument(chatId, mediaUrl, { caption: "✅ Media downloaded" });
    }
  } catch (err) {
    console.error("Error sending media:", err.message);
    await bot.sendMessage(chatId, `⚠️ Failed to send the media. Possibly unsupported format or too large.\nDirect link: ${mediaUrl}`);
  }
}

function guessMediaType(url) {
  const ext = url.split(".").pop().split("?")[0];
  if (["mp4", "mov", "avi", "webm"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  return "document";
}

// ========================
//  BOT HANDLERS
// ========================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🎥 *Instagram Media Downloader*

Send me any Instagram link (Reel, Post, Story, Carousel) and I'll download it for you!

*Supported:* Videos, images, carousels (all items)
*Note:* Private accounts not supported
  `;
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.includes("instagram.com")) return;

  bot.sendChatAction(chatId, "typing");
  const cleanUrl = cleanLink(text);
  const waitMsg = await bot.sendMessage(chatId, "⏳ Downloading media...");

  try {
    const media = await downloadInstagramMedia(cleanUrl);

    if (typeof media === "string") {
      const type = guessMediaType(media);
      console.log(`Sending ${type} to ${chatId}: ${media}`);
      await sendMedia(chatId, media, type);
    } else if (Array.isArray(media)) {
      await bot.sendMessage(chatId, `📦 Found ${media.length} items. Sending...`);
      for (let i = 0; i < media.length; i++) {
        const item = media[i];
        const type = guessMediaType(item);
        console.log(`Sending item ${i+1} (${type}) to ${chatId}: ${item}`);
        await sendMedia(chatId, item, type);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      await bot.sendMessage(chatId, "✅ All items sent!");
    } else {
      throw new Error("Unexpected response format");
    }

    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
  } catch (error) {
    console.error("Download error:", error.message);
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, `❌ ${error.message}`);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
