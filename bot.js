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
const userState = {};
let queue = [];
let processing = false;

// ===== TOKEN =====
function generateToken(userId) {
  const time = Date.now();
  const hash = crypto.createHash("sha256")
    .update(userId + time + SECRET)
    .digest("hex");
  return `${userId}.${time}.${hash}`;
}

function verifyToken(token, userId) {
  try {
    const [uid, time, hash] = token.split(".");
    if (parseInt(uid) !== userId) return false;

    const newHash = crypto.createHash("sha256")
      .update(uid + time + SECRET)
      .digest("hex");

    if (newHash !== hash) return false;

    if (Date.now() - time > 10 * 60 * 1000) return false;

    return true;
  } catch {
    return false;
  }
}

// ===== SHORT LINK =====
function shortLink(token) {
  return `https://your-shortlink.com/?redirect=https://t.me/${BOT_USERNAME}?start=${token}`;
}

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

  // RapidAPI ka response media array me hota hai
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

// ===== QUEUE =====
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
        fs.unlinkSync(file); // Delete video after 2 min
      }, 120000);

    } catch (err) {
      bot.sendMessage(chatId, "❌ Failed");
      console.log(err);
    }
  }

  processing = false;
}

// ===== MESSAGE HANDLER =====
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text || !text.includes("instagram.com")) return;

  if (!users.users.includes(userId)) users.users.push(userId);
  users.lastSeen[userId] = Date.now();
  saveUsers();

  const token = generateToken(userId);
  userState[chatId] = { link: text };

  bot.sendMessage(chatId, "👇 Unlock karo", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Unlock", url: shortLink(token) }]
      ]
    }
  });
});

// ===== VERIFY TOKEN =====
bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const token = match[1];

  if (!verifyToken(token, userId)) {
    return bot.sendMessage(chatId, "❌ Invalid");
  }

  if (!userState[chatId]) {
    return bot.sendMessage(chatId, "⚠️ Link bhejo pehle");
  }

  queue.push({
    chatId,
    link: userState[chatId].link
  });

  bot.sendMessage(chatId, "✅ Added to queue");

  processQueue();
});

// ===== ADMIN STATS =====
bot.onText(/\/stats/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  bot.sendMessage(msg.chat.id,
    `👥 Total Users: ${users.users.length}`
  );
});
