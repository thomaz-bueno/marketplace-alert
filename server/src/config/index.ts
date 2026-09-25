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
};
