const TelegramBot = require("node-telegram-bot-api");
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

// ========================
//  ENVIRONMENT VARIABLES
// ========================
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL; // e.g., https://your-app.onrender.com
const SHORTOX_API_KEY = process.env.SHORTOX_API_KEY;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

// ========================
//  EXPRESS SERVER
// ========================
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Store pending verifications
const pendingVerification = {};

// Download queue
let downloadQueue = [];
let isProcessing = false;

// ========================
//  TELEGRAM BOT
// ========================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========================
//  URL SHORTENER (Shortox)
// ========================
async function createShortLink(longUrl) {
  if (!SHORTOX_API_KEY) {
    console.warn("Shortox API key missing → using direct link");
    return longUrl;
  }

  try {
    const encodedUrl = encodeURIComponent(longUrl);
    const apiUrl = `https://shortox.com/api?api=${SHORTOX_API_KEY}&url=${encodedUrl}&format=text`;

    const response = await axios.get(apiUrl, { timeout: 10000 });
    // API returns plain text short link on success
    if (response.data && response.data.startsWith('http')) {
      return response.data;
    } else {
      throw new Error("Invalid response from Shortox");
    }
  } catch (error) {
    console.error("Shortox API error:", error.message);
    return longUrl; // fallback to direct link
  }
}

// ========================
//  DOWNLOAD & SEND
// ========================
function downloadWithParthDl(url) {
  return new Promise((resolve, reject) => {
    exec(`python download.py "${url}"`, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Download failed: ${error.message}\n${stderr}`));
        return;
      }
      const lines = stdout.trim().split('\n').filter(line => line.trim().length > 0);
      if (lines.length === 0) reject(new Error("No files downloaded"));
      else resolve(lines);
    });
  });
}

async function sendMedia(chatId, filePath) {
  let finalPath = filePath;
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const safeBase = base.replace(/[^a-zA-Z0-9.-]/g, '_');
    const safePath = path.join(dir, safeBase);
    if (safePath !== filePath && fs.existsSync(filePath)) {
      fs.renameSync(filePath, safePath);
      finalPath = safePath;
    }

    const ext = finalPath.split('.').pop().toLowerCase();
    if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) {
      await bot.sendVideo(chatId, finalPath, { caption: "✅ Video downloaded" });
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      await bot.sendPhoto(chatId, finalPath, { caption: "✅ Image downloaded" });
    } else {
      await bot.sendDocument(chatId, finalPath, { caption: "✅ Media downloaded" });
    }
    return finalPath;
  } catch (err) {
    console.error("Error sending media:", err.message);
    await bot.sendMessage(chatId, `⚠️ Failed to send file. Direct link: ${filePath}`);
    return null;
  }
}

// Queue processor – one download at a time
async function processQueue() {
  if (isProcessing) return;
  if (downloadQueue.length === 0) return;

  isProcessing = true;
  const { chatId, url } = downloadQueue.shift();

  const waitMsg = await bot.sendMessage(chatId, "⏳ Downloading media...").catch(() => null);

  try {
    const filePaths = await downloadWithParthDl(url);
    const sentPaths = [];

    if (filePaths.length === 1) {
      const sent = await sendMedia(chatId, filePaths[0]);
      if (sent) sentPaths.push(sent);
    } else {
      await bot.sendMessage(chatId, `📦 Found ${filePaths.length} items. Sending...`);
      for (let i = 0; i < filePaths.length; i++) {
        const sent = await sendMedia(chatId, filePaths[i]);
        if (sent) sentPaths.push(sent);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      await bot.sendMessage(chatId, "✅ All items sent!");
    }

    // Clean up temp files
    for (const filePath of sentPaths) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`Failed to delete ${filePath}:`, err.message);
      }
    }

    if (waitMsg) await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
  } catch (error) {
    console.error("Download error:", error.message);
    if (waitMsg) await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, `❌ ${error.message}\n\nTry another link or check if the post is public.`);
  } finally {
    isProcessing = false;
    processQueue(); // process next in queue
  }
}

function enqueueDownload(chatId, url) {
  downloadQueue.push({ chatId, url });
  processQueue();
}

// ========================
//  EXPRESS ROUTES
// ========================
app.get("/verify", (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).send("Missing token");
  }

  const data = pendingVerification[token];
  if (!data) {
    return res.status(404).send("Invalid or expired token");
  }

  delete pendingVerification[token];
  enqueueDownload(data.chatId, data.url);

  res.send(`
    <html>
      <head><title>Verification Successful</title></head>
      <body style="font-family: Arial; text-align: center; margin-top: 50px;">
        <h2>✅ Verification successful!</h2>
        <p>Your download will start shortly. Please wait...</p>
        <p>You can close this window.</p>
      </body>
    </html>
  `);
});

app.get("/", (req, res) => res.send("✅ Bot is running"));

app.listen(PORT, () => console.log(`Express server running on port ${PORT}`));

// ========================
//  BOT HANDLERS
// ========================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `🎥 *Instagram Media Downloader*\n\nSend me any Instagram link (Reel, Post, Carousel).\n\n*Verification required* – click the button below to start the download.`,
    { parse_mode: "Markdown" }
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.includes("instagram.com")) return;

  const token = crypto.randomBytes(16).toString('hex');
  const baseUrl = BASE_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}`;
  const verificationUrl = `${baseUrl}/verify?token=${token}`;

  pendingVerification[token] = {
    chatId,
    url: text.split("?")[0], // clean URL
    createdAt: Date.now()
  };

  const shortLink = await createShortLink(verificationUrl);

  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔗 Verify & Download", url: shortLink }]
      ]
    }
  };

  await bot.sendMessage(chatId,
    "⚠️ *Verification required*\n\nClick the button below to verify and start your download.",
    { parse_mode: "Markdown", ...inlineKeyboard }
  );
});

// Clean up expired tokens (5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of Object.entries(pendingVerification)) {
    if (now - data.createdAt > 5 * 60 * 1000) {
      delete pendingVerification[token];
    }
  }
}, 60 * 1000);

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
