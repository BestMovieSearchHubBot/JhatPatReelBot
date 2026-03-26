// ===== IMPORTS =====
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const BOT_USERNAME = process.env.BOT_USERNAME;
const SECRET = process.env.SECRET;
const RAPID_KEY = process.env.RAPID_API_KEY;

// ===== EXPRESS SERVER (Web Service) =====
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ===== BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== DATABASE =====
let users = { users: [], lastSeen: {} };
let cache = {};

if (fs.existsSync("users.json")) {
  users = JSON.parse(fs.readFileSync("users.json"));
}
if (fs.existsSync("cache.json")) {
  cache = JSON.parse(fs.readFileSync("cache.json"));
}

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users));
}
function saveCache() {
  fs.writeFileSync("cache.json", JSON.stringify(cache));
}

// ===== STATE =====
let queue = [];
let processing = false;

// ===== DOWNLOAD API (RapidAPI) =====
async function rapidDownload(link) {
  const res = await axios.get(
    "https://instagram-reels-downloader-api.p.rapidapi.com/download",
    {
      params: { url: link },
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": "instagram-reels-downloader-api.p.rapidapi.com",
        "x-rapidapi-key": RAPID_KEY
      }
    }
  );

  return res.data.media || res.data[0] || link;
}

// ===== BACKUP API =====
async function backupDownload(link) {
  const res = await axios.get(`https://api.agatz.xyz/api/ig?url=${link}`);
  return res.data.data[0].url;
}

// ===== MAIN DOWNLOAD =====
async function getVideo(link) {
  if (cache[link]) return cache[link];

  let videoUrl;
  try {
    videoUrl = await rapidDownload(link);
  } catch {
    videoUrl = await backupDownload(link);
  }

  cache[link] = videoUrl;
  saveCache();

  return videoUrl;
}

// ===== FILE DOWNLOAD =====
async function downloadFile(url) {
  const path = `video_${Date.now()}.mp4`;

  const res = await axios({
    url,
    method: "GET",
    responseType: "stream"
  });

  const writer = fs.createWriteStream(path);
  res.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(path));
    writer.on("error", reject);
  });
}

// ===== QUEUE PROCESS =====
async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const { chatId, link } = queue.shift();

    try {
      await bot.sendMessage(chatId, "⏳ Processing...");

      const videoUrl = await getVideo(link);
      const file = await downloadFile(videoUrl);

      const sent = await bot.sendVideo(chatId, file);

      setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        fs.unlinkSync(file); // delete after 2 minutes
      }, 120000);

    } catch (err) {
      console.log(err);
      bot.sendMessage(chatId, "❌ Failed to download");
    }
  }

  processing = false;
}

// ===== MESSAGE HANDLER =====
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text) return;

  // /start without token
  if (text === "/start") {
    bot.sendMessage(chatId, `👋 Hello! Send me an Instagram reel link to download.`);
    return;
  }

  // Only Instagram links
  if (!text.includes("instagram.com")) return;

  // Add user to DB
  if (!users.users.includes(userId)) users.users.push(userId);
  users.lastSeen[userId] = Date.now();
  saveUsers();

  // Add to queue
  queue.push({ chatId, link: text });
  bot.sendMessage(chatId, "✅ Link added to queue, processing...");
  processQueue();
});

// ===== ADMIN STATS =====
bot.onText(/\/stats/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  bot.sendMessage(msg.chat.id, `👥 Total Users: ${users.users.length}`);
});
