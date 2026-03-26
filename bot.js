const TelegramBot = require("node-telegram-bot-api");
const { exec } = require('child_process');
const fs = require('fs');
const express = require("express");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

// Express server to keep bot alive on Render
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is running"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Function to call Python download script
function downloadWithParthDl(url) {
    return new Promise((resolve, reject) => {
        // Execute Python script
        exec(`python download.py "${url}"`, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Download failed: ${error.message}\n${stderr}`));
                return;
            }
            // stdout contains file paths (one per line)
            const lines = stdout.trim().split('\n').filter(line => line.trim().length > 0);
            if (lines.length === 0) {
                reject(new Error("No files downloaded"));
                return;
            }
            // Return array of file paths
            resolve(lines);
        });
    });
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
        
        if (filePaths.length === 1) {
            // Single file
            await sendMedia(chatId, filePaths[0]);
        } else {
            // Multiple files (carousel)
            await bot.sendMessage(chatId, `📦 Found ${filePaths.length} items. Sending...`);
            for (let i = 0; i < filePaths.length; i++) {
                await sendMedia(chatId, filePaths[i]);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            await bot.sendMessage(chatId, "✅ All items sent!");
        }
        
        // Clean up temporary files
        for (const filePath of filePaths) {
            fs.unlinkSync(filePath);
        }
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        
    } catch (error) {
        console.error("Error:", error.message);
        await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, `❌ ${error.message}\n\nTry another link or check if the post is public.`);
    }
});

async function sendMedia(chatId, filePath) {
    try {
        // Determine file type from extension
        const ext = filePath.split('.').pop().toLowerCase();
        if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) {
            await bot.sendVideo(chatId, filePath, { caption: "✅ Video downloaded" });
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            await bot.sendPhoto(chatId, filePath, { caption: "✅ Image downloaded" });
        } else {
            await bot.sendDocument(chatId, filePath, { caption: "✅ Media downloaded" });
        }
    } catch (err) {
        console.error("Error sending media:", err.message);
        await bot.sendMessage(chatId, `⚠️ Failed to send the file. You can download it manually from: ${filePath}`);
    }
}

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});
