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
//  EXPRESS SERVER (keeps the bot alive on Render)
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

/**
 * Extracts the base Instagram URL (removes tracking parameters)
 */
function cleanLink(link) {
  return link.split("?")[0];
}

/**
 * Downloads Instagram media using RapidAPI
 * Returns an array of media URLs (for carousel posts) or a single URL string.
 */
async function downloadInstagramMedia(url) {
  try {
    const response = await axios.get(
      "https://instagram-reels-downloader-api.p.rapidapi.com/download",
      {
        params: { url },
        headers: {
          "x-rapidapi-key": RAPID_API_KEY,
          "x-rapidapi-host": "instagram-reels-downloader-api.p.rapidapi.com",
        },
        timeout: 15000, // 15 seconds timeout
      }
    );

    // The API response may contain:
    // - media: a string (single video/image)
    // - media: an array (multiple for carousel)
    const media = response.data.media;
    if (!media) throw new Error("No media found in API response");

    return media;
  } catch (error) {
    console.error("Download API error:", error.message);
    if (error.response) {
      console.error("API response data:", error.response.data);
    }
    throw new Error("Failed to fetch media from Instagram. Please check the link.");
  }
}

/**
 * Sends a single media (video or image) to Telegram
 */
async function sendMedia(chatId, mediaUrl, type) {
  try {
    if (type === "video") {
      await bot.sendVideo(chatId, mediaUrl, { caption: "✅ Video downloaded" });
    } else if (type === "image") {
      await bot.sendPhoto(chatId, mediaUrl, { caption: "✅ Image downloaded" });
    } else {
      // Fallback: let Telegram detect
      await bot.sendDocument(chatId, mediaUrl, { caption: "✅ Media downloaded" });
    }
  } catch (err) {
    console.error("Error sending media:", err.message);
    await bot.sendMessage(chatId, "⚠️ Failed to send the media. Possibly unsupported format or too large.");
  }
}

/**
 * Determines media type based on URL extension or content type (simplified)
 */
function guessMediaType(url) {
  const ext = url.split(".").pop().split("?")[0];
  if (["mp4", "mov", "avi"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "gif"].includes(ext)) return "image";
  return "document";
}

// ========================
//  BOT HANDLERS
// ========================

// Handle /start command
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

// Handle all messages that contain an Instagram link
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Check if message contains an Instagram URL
  if (!text.includes("instagram.com")) return;

  // Show typing indicator
  bot.sendChatAction(chatId, "typing");

  // Extract the clean link (remove tracking parameters)
  const cleanUrl = cleanLink(text);

  // Send initial waiting message
  const waitMsg = await bot.sendMessage(chatId, "⏳ Downloading media...");

  try {
    const media = await downloadInstagramMedia(cleanUrl);

    // If media is a string, treat as single media
    if (typeof media === "string") {
      const type = guessMediaType(media);
      await sendMedia(chatId, media, type);
    }
    // If media is an array, send each item
    else if (Array.isArray(media)) {
      await bot.sendMessage(chatId, `📦 Found ${media.length} items. Sending...`);
      for (let i = 0; i < media.length; i++) {
        const item = media[i];
        const type = guessMediaType(item);
        await sendMedia(chatId, item, type);
        // Small delay to avoid flooding Telegram API
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await bot.sendMessage(chatId, "✅ All items sent!");
    } else {
      throw new Error("Unexpected response format");
    }

    // Delete the waiting message (optional)
    bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

  } catch (error) {
    console.error("Download error:", error.message);
    // Delete waiting message and send error
    bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    bot.sendMessage(chatId, `❌ ${error.message}`);
  }
});

// ========================
//  GLOBAL ERROR HANDLING
// ========================
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Optionally notify admin via bot
});
