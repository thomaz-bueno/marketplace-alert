import path from "node:path";
import dotenv from "dotenv";

const ROOT_ENV = path.resolve(__dirname, "../../../.env");

dotenv.config({ path: [path.resolve(process.cwd(), ".env"), ROOT_ENV] });

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`Invalid ${name}: ${raw}`);
}

/**
 * Telegram notifications are optional: when the variables are missing or
 * invalid the backend keeps running with notifications disabled and a safe
 * reason (never the token or chat id) for the startup log.
 */
function readTelegram(): {
  botToken: string;
  chatId: string;
  enabled: boolean;
  disabledReason: string | null;
} {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";

  const disabled = (disabledReason: string) => ({
    botToken,
    chatId,
    enabled: false,
    disabledReason,
  });

  if (botToken === "" && chatId === "") {
    return disabled("not configured");
  }
  if (botToken === "" || chatId === "") {
    return disabled("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set");
  }
  if (!/^\d+:\S+$/.test(botToken)) {
    return disabled(
      "TELEGRAM_BOT_TOKEN has an invalid format (expected <bot_id>:<secret>)",
    );
  }
  if (!/^-?\d+$/.test(chatId) && !/^@[A-Za-z0-9_]{4,}$/.test(chatId)) {
    return disabled(
      "TELEGRAM_CHAT_ID must be a numeric id (groups are negative) or a @username",
    );
  }

  return { botToken, chatId, enabled: true, disabledReason: null };
}

const telegram = readTelegram();

export const config = {
  port: readPort("SERVER_PORT", 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  nodeEnv: process.env.NODE_ENV ?? "development",
  browserHeadless: readBoolean("BROWSER_HEADLESS", false),
  browserUserDataDir:
    process.env.BROWSER_USER_DATA_DIR?.trim() ||
    path.resolve(__dirname, "../../../.browser-profile"),
  cronSchedule: process.env.CRON_SCHEDULE?.trim() || "*/15 * * * *",
  telegramBotToken: telegram.botToken,
  telegramChatId: telegram.chatId,
  telegramEnabled: telegram.enabled,
  telegramDisabledReason: telegram.disabledReason,
};
