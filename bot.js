const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");

// ===== EXPRESS =====
const app = express();
app.get("/", (req, res) => res.send("Bot Running ✅"));
app.listen(process.env.PORT || 3000);

// ===== ENV =====
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ===== CLEAN LINK =====
function cleanLink(link) {
  return link.split("?")[0];
}

// ===== DOWNLOAD =====
async function download(link) {
  const res = await axios.get(
    "https://instagram-reels-downloader-api.p.rapidapi.com/download",
    {
      params: { url: link },
      headers: {
        "x-rapidapi-key": process.env.RAPID_API_KEY,
        "x-rapidapi-host": "instagram-reels-downloader-api.p.rapidapi.com"
      }
    }
  );

  return res.data.media;
}

// ===== BOT =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.includes("instagram.com")) return;

  const link = cleanLink(text);

  await bot.sendMessage(chatId, "⏳ Download ho raha hai...");

  try {
    const videoUrl = await download(link);

    await bot.sendVideo(chatId, videoUrl, {
      caption: "✅ Downloaded"
    });

  } catch (err) {
    console.log(err.message);
    bot.sendMessage(chatId, "❌ Failed");
  }
});
