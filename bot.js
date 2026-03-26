const TelegramBot = require("node-telegram-bot-api");
const { exec } = require('child_process');
const fs = require('fs');
const express = require("express");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

// Express server (Render ke liye)
const app = express();
app.get("/", (req, res) => res.send("✅ Bot is running"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// parth-dl को call करने वाली function
async function downloadWithParthDl(url) {
    return new Promise((resolve, reject) => {
        const outputFile = `/tmp/instagram_${Date.now()}.mp4`;
        
        // parth-dl CLI command
        const command = `parth-dl "${url}" -o "${outputFile}"`;
        
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Download failed: ${error.message}`));
                return;
            }
            
            // Check if file was created
            if (fs.existsSync(outputFile)) {
                resolve(outputFile);
            } else {
                reject(new Error("File not created"));
            }
        });
    });
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🎥 *Instagram Media Downloader*\n\nSend me any Instagram link (Reel, Post, Carousel) and I'll download it!\n\n*No API key needed*`, { parse_mode: "Markdown" });
});

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || !text.includes("instagram.com")) return;
    
    bot.sendChatAction(chatId, "upload_video");
    const waitMsg = await bot.sendMessage(chatId, "⏳ Downloading media...");
    
    try {
        const filePath = await downloadWithParthDl(text);
        
        // Send video
        await bot.sendVideo(chatId, filePath, { caption: "✅ Downloaded using parth-dl" });
        
        // Clean up temp file
        fs.unlinkSync(filePath);
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
