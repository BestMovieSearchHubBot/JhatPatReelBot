const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");
const express = require("express");

// ===== EXPRESS (Render ke liye) =====
const app = express();
app.get("/", (req, res) => res.send("Bot Running"));
app.listen(process.env.PORT || 3000);

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;

// ===== BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== yt-dlp download =====
function downloadWithYtdlp(link) {
  return new Promise((resolve, reject) => {
    const file = `video_${Date.now()}.mp4`;

    exec(`yt-dlp -f best -o "${file}" "${link}"`, (err) => {
      if (err) return reject(err);
      resolve(file);
    });
  });
}

// ===== API fallback =====
async function downloadWithAPI(link) {
  try {
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

    return res.data.media; // direct video URL
  } catch {
    return null;
  }
}

// ===== MAIN =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.includes("instagram.com")) return;

  bot.sendMessage(chatId, "⏳ Download ho raha hai...");

  let filePath;

  try {
    // 🔥 TRY yt-dlp FIRST
    filePath = await downloadWithYtdlp(text);

    await bot.sendVideo(chatId, filePath, {
      caption: "✅ Downloaded via yt-dlp"
    });

  } catch (err) {

    console.log("yt-dlp failed, trying API...");

    // 🔥 FALLBACK API
    const videoUrl = await downloadWithAPI(text);

    if (!videoUrl) {
      return bot.sendMessage(chatId, "❌ Download failed");
    }

    await bot.sendVideo(chatId, videoUrl, {
      caption: "✅ Downloaded via API"
    });

    return;
  }

  // 🔥 AUTO DELETE FILE
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
});
