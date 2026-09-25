import { createClient } from "redis";
import { config } from "../../config";

export type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connecting: Promise<RedisClient> | null = null;

export function getRedis(): RedisClient {
  if (!client) {
    client = createClient({ url: config.redisUrl });
    client.on("error", (error) => {
      console.error("[redis] error:", error.message);
    });
  }
  return client;
}

export async function connectRedis(): Promise<RedisClient> {
  const redis = getRedis();
  if (redis.isReady) return redis;

  if (!connecting) {
    connecting = redis.connect().then(
      () => redis,
      (error: unknown) => {
        connecting = null;
        throw error;
      },
    );
  }
  return connecting;
}

export async function closeRedis(): Promise<void> {
  if (client && client.isOpen) {
    await client.quit();
  }
  client = null;
  connecting = null;
}
