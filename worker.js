/**
 *  QR Code Generator Telegram Bot
 *  ---------------------------------
 *  Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
 *
 *  A serverless QR generator running on Cloudflare Workers.
 *  Feel free to fork, modify, and share!
 */




// Enhanced QR Code Generator Telegram Bot - Fixed Markdown Parsing
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

const QR_APIS = [
  {
    name: "goQR",
    url: (text, size) => `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`,
  },
  {
    name: "quickChart",
    url: (text, size) => `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=${size}`,
  },
];

// Safer escape for MarkdownV2 - additionally removes any trailing backslash that could break code blocks
function safeEscapeMarkdown(text) {
  if (!text) return "";
  // Remove trailing backslashes that could interfere with Markdown parsing
  let clean = text.replace(/\\+$/, '');
  const escapeChars = /[_*[\]()~`>#+=|{}.!-]/g;
  return clean.replace(escapeChars, '\\$&');
}

async function callTelegramApi(token, method, payload) {
  const url = `${TELEGRAM_API_BASE}${token}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function generateQrUrl(text, size = 300, providerIndex = 0) {
  const provider = QR_APIS[providerIndex] || QR_APIS[0];
  return provider.url(text, size);
}

async function isUrlReachable(url, timeoutMs = 4000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;// Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
  } catch {
    return false;
  }
}

// KV helpers
async function getTotalQrCount(env) {
  const val = await env.BOT_STATE.get("total_qr_count");
  return val ? parseInt(val, 10) : 0;
}

async function incrementTotalCount(env) {
  const current = await getTotalQrCount(env);
  const newCount = current + 1;
  await env.BOT_STATE.put("total_qr_count", newCount.toString());
  return newCount;
}

async function getUserQrCount(env, userId) {
  const val = await env.BOT_STATE.get(`user:${userId}:count`);
  return val ? parseInt(val, 10) : 0;
}

async function incrementUserCount(env, userId) {
  const current = await getUserQrCount(env, userId);
  const newCount = current + 1;
  await env.BOT_STATE.put(`user:${userId}:count`, newCount.toString());
  return newCount;
}

async function checkRateLimit(env, userId) {
  const now = Date.now();
  const key = `rate:${userId}`;
  let timestamps = await env.BOT_STATE.get(key);
  timestamps = timestamps ? JSON.parse(timestamps) : [];
  const windowStart = now - 10000;
  timestamps = timestamps.filter(ts => ts > windowStart);
  if (timestamps.length >= 5) {
    return { allowed: false, retryAfter: Math.ceil((timestamps[0] + 10000 - now) / 1000) };
  }
  timestamps.push(now);
  await env.BOT_STATE.put(key, JSON.stringify(timestamps), { expirationTtl: 60 });
  return { allowed: true };
}

function parseCommand(text) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  let size = 300;
  let content = "";
  if (parts.length > 1) {
    const sizeArg = parts[1].toLowerCase();
    if (['small', 'medium', 'large'].includes(sizeArg)) {
      const sizeMap = { small: 150, medium: 300, large: 500 };
      size = sizeMap[sizeArg];
      content = parts.slice(2).join(' ');
    } else {
      content = parts.slice(1).join(' ');
    }
  }
  return { size, content };
}
// Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
export default {
  async fetch(request, env, ctx) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return new Response("TELEGRAM_BOT_TOKEN not set", { status: 500 });

    const url = new URL(request.url);

    if (request.method === "POST") {
      try {
        const update = await request.json();
        const msg = update.message;
        const callback = update.callback_query;

        if (callback) {
          const chatId = callback.message.chat.id;
          const data = callback.data;
          const userId = callback.from.id;
          if (data === "mystats") {
            const count = await getUserQrCount(env, userId);
            await callTelegramApi(token, "answerCallbackQuery", { callback_query_id: callback.id });
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: `📊 *Your QR Stats*\n\nYou have generated ${count} QR codes\\.`,
              parse_mode: "MarkdownV2",
            });
          } else if (data === "globalstats") {
            const count = await getTotalQrCount(env);
            await callTelegramApi(token, "answerCallbackQuery", { callback_query_id: callback.id });
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: `🌍 *Global QR Stats*\n\nTotal QR codes generated: ${count}`,
              parse_mode: "MarkdownV2",
            });
          } else if (data === "new") {
            await callTelegramApi(token, "answerCallbackQuery", { callback_query_id: callback.id });
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: "Send me any text to generate a QR code\\.",
              parse_mode: "MarkdownV2",// Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
            });
          }
          return new Response("OK", { status: 200 });
        }

        if (!msg) return new Response("OK", { status: 200 });

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text || "";

        if (text.startsWith("/start") || text.startsWith("/help")) {
          const welcome = `🎯 *QR Code Generator Bot*\n\n` +
            `Send me any text to get a QR code\\.\n` +
            `Use \\/qr \\[size\\] \\<text\\> to customize size \\(small/medium/large\\)\\.\n` +
            `Example: \\/qr large Hello World\n\n` +
            `*Commands:*\n` +
            `\\/stats \\- Global statistics\n` +
            `\\/mystats \\- Your personal stats\n` +
            `\\/help \\- Show this message`;
          await callTelegramApi(token, "sendMessage", {
            chat_id: chatId,
            text: welcome,
            parse_mode: "MarkdownV2",
          });
        } else if (text.startsWith("/stats")) {
          const count = await getTotalQrCount(env);
          await callTelegramApi(token, "sendMessage", {
            chat_id: chatId,
            text: `🌍 *Total QR Codes Generated*\n\n${count} QR codes created so far\\.`,
            parse_mode: "MarkdownV2",
          });
        } else if (text.startsWith("/mystats")) {
          const count = await getUserQrCount(env, userId);
          await callTelegramApi(token, "sendMessage", {
            chat_id: chatId,
            text: `📊 *Your QR Stats*\n\nYou have generated ${count} QR codes\\.`,
            parse_mode: "MarkdownV2",
          });
        } else {
          const rate = await checkRateLimit(env, userId);
          if (!rate.allowed) {
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: `⚠️ *Rate limit exceeded*\n\nPlease wait ${rate.retryAfter} seconds before generating another QR code\\.`,
              parse_mode: "MarkdownV2",
            });
            return new Response("OK", { status: 200 });
          }// Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)

          let size = 300;
          let content = text;
          if (text.startsWith("/qr ")) {
            const parsed = parseCommand(text);
            size = parsed.size;
            content = parsed.content;
          }

          if (!content) {
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: "Please provide text to encode in the QR code\\.",
              parse_mode: "MarkdownV2",
            });
            return new Response("OK", { status: 200 });
          }

          await callTelegramApi(token, "sendChatAction", {
            chat_id: chatId,
            action: "upload_photo",
          });
// Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
          let qrUrl = null;
          let providerUsed = null;
          for (let i = 0; i < QR_APIS.length; i++) {
            const candidateUrl = generateQrUrl(content, size, i);
            const reachable = await isUrlReachable(candidateUrl);
            if (reachable) {
              qrUrl = candidateUrl;
              providerUsed = QR_APIS[i].name;
              break;
            }
          }

          if (!qrUrl) {
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: "❌ *QR generation failed*\n\nAll QR providers are currently unavailable\\. Please try again later\\.",
              parse_mode: "MarkdownV2",
            });
            return new Response("OK", { status: 200 });
          }

          // Safe caption: use plain text if the content contains suspicious characters
          const displayText = content.length > 50 ? content.slice(0, 50) + "…" : content;
          // We'll use MarkdownV2 only for the fixed parts, not the user text
          const caption = `🔳 *QR Code Generated*\n\nText: \`\`\`\n${displayText}\n\`\`\`\nSize: ${size}px`;
          
          const inlineKeyboard = {
            inline_keyboard: [
              [
                { text: "📊 My Stats", callback_data: "mystats" },
                { text: "🌍 Global Stats", callback_data: "globalstats" },
              ],
              [{ text: "🔄 Generate Another", callback_data: "new" }],
            ],
          };

          // Use try-catch for sendPhoto; if Markdown fails, fallback to plain text
          let result;
          try {
            result = await callTelegramApi(token, "sendPhoto", {
              chat_id: chatId,
              photo: qrUrl,
              caption: caption,
              parse_mode: "MarkdownV2",
              reply_markup: inlineKeyboard,
            });
          } catch (e) {
            // If still fails, send without parse_mode
            console.warn("Markdown send failed, falling back to plain caption:", e);
            result = await callTelegramApi(token, "sendPhoto", {
              chat_id: chatId,
              photo: qrUrl,
              caption: `🔳 QR Code Generated\n\nText: ${displayText}\nSize: ${size}px`,
              reply_markup: inlineKeyboard,
            });
          }
// Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
          if (result.ok) {
            await incrementTotalCount(env);
            await incrementUserCount(env, userId);
            console.log(`QR generated for user ${userId} using ${providerUsed}. Total: ${await getTotalQrCount(env)}`);
          } else {
            console.error("Telegram sendPhoto error:", result);
            await callTelegramApi(token, "sendMessage", {
              chat_id: chatId,
              text: `❌ Failed to send QR image\n\nTelegram error: ${result.description || "unknown"}`,
            });
          }
        }

        return new Response("OK", { status: 200 });
      } catch (e) {
        console.error("Webhook error:", e);
        return new Response("Error", { status: 500 });
      }
    }
// Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
    if (request.method === "GET") {
      if (url.pathname === "/set-webhook") {
        const workerUrl = `${url.protocol}//${url.hostname}`;
        const webhookUrl = `${workerUrl}/webhook`;
        const result = await callTelegramApi(token, "setWebhook", { url: webhookUrl });
        return new Response(JSON.stringify(result, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      } // Made with 💖 by [pavnxet](https://github.com/pavnxet/qr-telegram-bot)
      return new Response("Enhanced QR Bot is running.", { status: 200 });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};
