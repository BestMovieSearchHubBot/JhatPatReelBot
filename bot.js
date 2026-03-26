// ===== IMPORTS =====
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { exec } = require("child_process");
const path = require("path");

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const BOT_USERNAME = process.env.BOT_USERNAME;
const SECRET = process.env.SECRET;

// ===== EXPRESS SERVER =====
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ===== BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== DATABASE =====
let users = { users: [], lastSeen: {} };

if (fs.existsSync("users.json")) {
  users = JSON.parse(fs.readFileSync("users.json"));
}

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users));
}

// ===== STATE =====
let queue = [];
let processing = false;

// ===== TOKEN (optional unlock) =====
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

// ===== FILE DOWNLOAD via yt-dlp (max 720p) =====
async function downloadVideo(link) {
  return new Promise((resolve, reject) => {
    const filename = `video_${Date.now()}.mp4`;
    const filepath = path.join(__dirname, filename);

    // yt-dlp command: best format under 720p
    const cmd = `yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" -o "${filepath}" "${link}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.log(stderr);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        return reject(error);
      }
      resolve(filepath);
    });
  });
}

// ===== QUEUE PROCESS =====
async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const { chatId, link } = queue.shift();

    let file;
    try {
      await bot.sendMessage(chatId, "⏳ Processing your video...");

      file = await downloadVideo(link);

      // sendDocument ensures video is downloadable/playable
      const sent = await bot.sendDocument(chatId, file, { caption: "Here is your video 🎬" });

      // delete after 2 min (server cleanup)
      setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }, 120000);

    } catch (err) {
      console.log(err);
      bot.sendMessage(chatId, "❌ Failed to download video");
      // Cleanup partial file if exists
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
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
