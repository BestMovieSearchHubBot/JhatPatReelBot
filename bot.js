const TelegramBot = require("node-telegram-bot-api");
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const mongoose = require("mongoose");

// ========================
//  ENVIRONMENT VARIABLES
// ========================
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL;
const SHORTOX_API_KEY = process.env.SHORTOX_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const CHANNEL_ID = process.env.CHANNEL_ID;
const AMAZON_VOUCHER_CODE = process.env.AMAZON_VOUCHER_CODE;
const CYCLE_DAYS = 30;

if (!BOT_TOKEN || !MONGODB_URI) {
  console.error("❌ Missing required environment variables: BOT_TOKEN, MONGODB_URI");
  process.exit(1);
}

// ========================
//  MONGODB CONNECTION WITH BETTER HANDLING
// ========================
console.log("📡 Connecting to MongoDB...");

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
})
.then(() => console.log("✅ MongoDB connected successfully"))
.catch(err => {
  console.error("❌ MongoDB connection error:", err.message);
  console.log("⚠️ Bot will continue without leaderboard features");
});

mongoose.connection.on('error', err => {
  console.error("MongoDB error:", err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log("MongoDB disconnected");
});

// ========================
//  DATABASE MODELS
// ========================
const cycleSchema = new mongoose.Schema({
  startDate: { type: Date, default: Date.now, required: true },
  ended: { type: Boolean, default: false }
});
const Cycle = mongoose.model('Cycle', cycleSchema);

const userStatSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  username: { type: String, default: '' },
  downloadCount: { type: Number, default: 0 },
  cycle: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true }
});
userStatSchema.index({ userId: 1, cycle: 1 }, { unique: true });
const UserStat = mongoose.model('UserStat', userStatSchema);

// Helper to get or create current active cycle
let currentCycle = null;
let dbConnected = false;

async function getCurrentCycle() {
  if (!dbConnected) {
    if (mongoose.connection.readyState !== 1) {
      console.log("Waiting for MongoDB connection...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (mongoose.connection.readyState !== 1) {
        console.error("MongoDB not connected, returning null cycle");
        return null;
      }
    }
    dbConnected = true;
  }
  
  try {
    if (currentCycle && !currentCycle.ended) return currentCycle;
    const cycle = await Cycle.findOne({ ended: false });
    if (cycle) {
      currentCycle = cycle;
      return cycle;
    }
    const newCycle = new Cycle({ startDate: new Date(), ended: false });
    await newCycle.save();
    currentCycle = newCycle;
    return newCycle;
  } catch (err) {
    console.error("Error getting cycle:", err.message);
    return null;
  }
}

// Helper to get cycle info (remaining days, end date)
async function getCycleInfo() {
  const cycle = await getCurrentCycle();
  if (!cycle) return { daysLeft: null, endDate: null };
  const endDate = new Date(cycle.startDate);
  endDate.setDate(endDate.getDate() + CYCLE_DAYS);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
  return { daysLeft, endDate };
}

async function incrementUserDownload(userId, username) {
  try {
    const cycle = await getCurrentCycle();
    if (!cycle) return;
    
    let stat = await UserStat.findOne({ userId, cycle: cycle._id });
    if (!stat) {
      stat = new UserStat({ userId, username, downloadCount: 0, cycle: cycle._id });
    }
    stat.downloadCount += 1;
    if (username && username !== stat.username) stat.username = username;
    await stat.save();
  } catch (err) {
    console.error("Error incrementing download count:", err.message);
  }
}

// ========================
//  EXPRESS SERVER
// ========================
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const pendingVerification = {};
let downloadQueue = [];
let isProcessing = false;
const userVerifiedCache = {};
const VERIFICATION_VALIDITY_HOURS = 24;

// ========================
//  TELEGRAM BOT
// ========================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========================
//  SHORTOX SHORTENER
// ========================
async function createShortLink(longUrl) {
  if (!SHORTOX_API_KEY) return longUrl;
  try {
    const encodedUrl = encodeURIComponent(longUrl);
    const apiUrl = `https://shortox.com/api?api=${SHORTOX_API_KEY}&url=${encodedUrl}&format=text`;
    const response = await axios.get(apiUrl, { timeout: 10000 });
    if (response.data && response.data.startsWith('http')) return response.data;
    else return longUrl;
  } catch (error) {
    console.error("Shortox error:", error.message);
    return longUrl;
  }
}

// ========================
//  DOWNLOAD & SEND
// ========================
function downloadWithParthDl(url) {
  return new Promise((resolve, reject) => {
    exec(`python download.py "${url}"`, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Download failed: ${error.message}\n${stderr}`));
      else {
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        if (lines.length === 0) reject(new Error("No files downloaded"));
        else resolve(lines);
      }
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
    console.error("Send error:", err.message);
    await bot.sendMessage(chatId, `⚠️ Failed to send file. Direct link: ${filePath}`);
    return null;
  }
}

async function processQueue() {
  if (isProcessing) return;
  if (downloadQueue.length === 0) return;
  isProcessing = true;
  const { chatId, url, userId, username } = downloadQueue.shift();

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
        await new Promise(r => setTimeout(r, 500));
      }
      await bot.sendMessage(chatId, "✅ All items sent!");
    }

    if (userId) {
      await incrementUserDownload(userId, username);
    }

    for (const p of sentPaths) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
    }

    if (waitMsg) await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
  } catch (error) {
    console.error("Download error:", error.message);
    if (waitMsg) await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, `❌ ${error.message}\n\nTry another link or check if the post is public.`);
  } finally {
    isProcessing = false;
    processQueue();
  }
}

function enqueueDownload(chatId, url, userId, username) {
  downloadQueue.push({ chatId, url, userId, username });
  processQueue();
}

// ========================
//  LEADERBOARD FUNCTIONS (with error handling)
// ========================
async function getLeaderboard() {
  try {
    const cycle = await getCurrentCycle();
    if (!cycle) return [];
    const topUsers = await UserStat.find({ cycle: cycle._id })
      .sort({ downloadCount: -1 })
      .limit(10)
      .lean();
    return topUsers;
  } catch (err) {
    console.error("Error getting leaderboard:", err.message);
    return [];
  }
}

async function getUserRank(userId) {
  try {
    const cycle = await getCurrentCycle();
    if (!cycle) return { rank: null, count: 0 };
    const userStat = await UserStat.findOne({ userId, cycle: cycle._id });
    if (!userStat) return { rank: null, count: 0 };
    const countHigher = await UserStat.countDocuments({
      cycle: cycle._id,
      downloadCount: { $gt: userStat.downloadCount }
    });
    return { rank: countHigher + 1, count: userStat.downloadCount };
  } catch (err) {
    console.error("Error getting user rank:", err.message);
    return { rank: null, count: 0 };
  }
}

async function awardWinner(cycle) {
  try {
    const topUser = await UserStat.findOne({ cycle: cycle._id })
      .sort({ downloadCount: -1 });
    if (!topUser || topUser.downloadCount === 0) {
      console.log("No downloads in this cycle, no winner.");
      return;
    }

    try {
      await bot.sendMessage(topUser.userId, 
        `🎉 Congratulations! You are the top downloader of the last ${CYCLE_DAYS}-day cycle with ${topUser.downloadCount} downloads!\n\nYou have won an Amazon Gift Voucher worth ₹500.\n\nVoucher Code: \`${AMAZON_VOUCHER_CODE}\``,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      console.error("Failed to send private message to winner:", e.message);
    }

    if (CHANNEL_ID) {
      const winnerName = topUser.username || `User ${topUser.userId}`;
      const message = `🏆 *Cycle Winner!*\n\n@${winnerName} is the top downloader of the past ${CYCLE_DAYS} days with ${topUser.downloadCount} downloads!\n\nThey have won a ₹500 Amazon Gift Voucher. Congratulations! 🎉\n\nA new cycle has started – compete again!`;
      try {
        await bot.sendMessage(CHANNEL_ID, message, { parse_mode: "Markdown" });
      } catch (e) {
        console.error("Failed to send channel message:", e.message);
      }
    }
  } catch (err) {
    console.error("Error awarding winner:", err.message);
  }
}

async function checkCycleEnd() {
  try {
    const cycle = await getCurrentCycle();
    if (!cycle) return;
    const now = new Date();
    const cycleEnd = new Date(cycle.startDate);
    cycleEnd.setDate(cycleEnd.getDate() + CYCLE_DAYS);
    if (now >= cycleEnd && !cycle.ended) {
      cycle.ended = true;
      await cycle.save();
      await awardWinner(cycle);
      currentCycle = null;
      await getCurrentCycle();
      console.log(`New cycle started after ${CYCLE_DAYS} days`);
    }
  } catch (err) {
    console.error("Error checking cycle end:", err.message);
  }
}

setInterval(checkCycleEnd, 60 * 60 * 1000);
checkCycleEnd();

// ========================
//  EXPRESS ROUTES
// ========================
app.get("/verify", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send("Missing token");
  const data = pendingVerification[token];
  if (!data) return res.status(404).send("Invalid or expired token");

  userVerifiedCache[data.userId] = { verifiedAt: Date.now() };
  delete pendingVerification[token];
  enqueueDownload(data.chatId, data.url, data.userId, data.username);

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
//  BOT COMMANDS
// ========================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `🎥 *Instagram Media Downloader*\n\nSend me any Instagram link (Reel, Post, Carousel).\n\n*Verification required* – click the button below to start the download.\n\n🏆 *Win ₹500 Amazon Gift Voucher!*\nTop downloader every 30 days wins.\n\nUse /rank to see leaderboard.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/rank/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const topUsers = await getLeaderboard();
    const { rank, count } = await getUserRank(userId);
    const { daysLeft } = await getCycleInfo();

    let leaderboardText = `🏆 *Leaderboard – Top 10*\n\n`;
    
    if (topUsers.length === 0) {
      leaderboardText += "No downloads yet in the current cycle. Be the first!\n\n";
    } else {
      for (let i = 0; i < topUsers.length; i++) {
        const u = topUsers[i];
        const name = u.username || `User ${u.userId}`;
        leaderboardText += `${i+1}. ${name} – ${u.downloadCount} downloads\n`;
      }
      leaderboardText += `\n`;
    }

    // Prize and cycle info
    if (daysLeft !== null) {
      leaderboardText += `🎁 *Top 1 wins ₹500 Amazon Gift Voucher!*\n`;
      leaderboardText += `📅 *Cycle ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}*\n\n`;
    }

    leaderboardText += `*Your Stats:*\n`;
    if (rank) {
      leaderboardText += `Rank: #${rank}\nDownloads: ${count}`;
    } else {
      leaderboardText += `You haven't downloaded anything yet in the current cycle.`;
    }

    await bot.sendMessage(chatId, leaderboardText, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error in /rank command:", err.message);
    await bot.sendMessage(chatId, "⚠️ Error loading leaderboard. Please try again later.");
  }
});

// Handle Instagram links
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || !text.includes("instagram.com")) return;

  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;
  const cleanUrl = text.split("?")[0];

  const cacheEntry = userVerifiedCache[userId];
  const now = Date.now();
  if (cacheEntry && (now - cacheEntry.verifiedAt) < VERIFICATION_VALIDITY_HOURS * 60 * 60 * 1000) {
    enqueueDownload(chatId, cleanUrl, userId, username);
    await bot.sendMessage(chatId, "✅ You are already verified. Download started...");
    return;
  }

  const token = crypto.randomBytes(16).toString('hex');
  const baseUrl = BASE_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}`;
  const verificationUrl = `${baseUrl}/verify?token=${token}`;

  pendingVerification[token] = {
    chatId,
    url: cleanUrl,
    userId,
    username,
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
    "⚠️ *Verification required*\n\nClick the button below to verify and start your download.\n\n(You will only need to verify once every 24 hours.)",
    { parse_mode: "Markdown", ...inlineKeyboard }
  );
});

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
