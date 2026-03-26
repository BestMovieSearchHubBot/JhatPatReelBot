const TelegramBot = require("node-telegram-bot-api");
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require("express");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

const app = express();
app.get("/", (req, res) => res.send("✅ Bot is running"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function downloadWithParthDl(url) {
    return new Promise((resolve, reject) => {
        exec(`python download.py "${url}"`, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Download failed: ${error.message}\n${stderr}`));
                return;
            }
            const lines = stdout.trim().split('\n').filter(line => line.trim().length > 0);
            if (lines.length === 0) {
                reject(new Error("No files downloaded"));
                return;
            }
            resolve(lines);
        });
    });
}

async function sendMedia(chatId, filePath) {
    let finalPath = filePath;
    try {
        // Sanitize filename to avoid special characters
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
    } catch (err) {
        console.error("Error sending media:", err.message);
        await bot.sendMessage(chatId, `⚠️ Failed to send the file. You can download it manually from: ${filePath}`);
        return null;
    }
    return finalPath;
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        `🎥 *Instagram Media Downloader*\n\nSend me any Instagram link (Reel, Post, Carousel) and I'll download it!\n\n*No API key needed*`, 
        { parse_mode: "Markdown" }
    );
});

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || !text.includes("instagram.com")) return;

    bot.sendChatAction(chatId, "upload_video");
    const waitMsg = await bot.sendMessage(chatId, "⏳ Downloading media...");

    try {
        const filePaths = await downloadWithParthDl(text);
        const sentPaths = [];

        if (filePaths.length === 1) {
            const sentPath = await sendMedia(chatId, filePaths[0]);
            if (sentPath) sentPaths.push(sentPath);
        } else {
            await bot.sendMessage(chatId, `📦 Found ${filePaths.length} items. Sending...`);
            for (let i = 0; i < filePaths.length; i++) {
                const sentPath = await sendMedia(chatId, filePaths[i]);
                if (sentPath) sentPaths.push(sentPath);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            await bot.sendMessage(chatId, "✅ All items sent!");
        }

        // Clean up files after sending
        for (const filePath of sentPaths) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`Deleted: ${filePath}`);
                }
            } catch (unlinkErr) {
                console.error(`Failed to delete ${filePath}:`, unlinkErr.message);
            }
        }

        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    } catch (error) {
        console.error("Error:", error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, `❌ ${error.message}\n\nTry another link or check if the post is public.`);
    }
});

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});
