import { connectRedis } from "../../infrastructure/redis/client";
import type { Product } from "../products";

/**
 * Cross-cycle record of products already delivered to Telegram.
 *
 * The per-cycle product hashes (`alert:*:products`) are a temporary snapshot
 * cleared at the start of every cycle — they are NOT delivery tracking. This
 * SET lives under a key outside that pattern and is written only after the
 * Bot API accepted the request (HTTP 2xx).
 *
 * Delivery is at-least-once, never exactly-once: if Telegram accepts a
 * request while the backend loses the response (timeout, crash mid-send),
 * nothing is recorded and the same products may be sent again in the next
 * cycle. Duplicates are preferred over silently losing products.
 */
const NOTIFIED_KEY = "notified:products";

/**
 * Returns only the products whose id has never been confirmed as notified.
 * Uses one MULTI round-trip regardless of batch size; products with an
 * empty id are dropped (they are never persisted or shown by the UI).
 */
export async function filterNotified(products: Product[]): Promise<Product[]> {
  const candidates = products.filter((product) => product.id.trim() !== "");
  if (candidates.length === 0) return [];

  const redis = await connectRedis();
  const multi = redis.multi();
  for (const product of candidates) {
    multi.sIsMember(NOTIFIED_KEY, product.id);
  }
  const replies = (await multi.exec()) ?? [];
  const flags = replies as unknown[];

  return candidates.filter((_, index) => {
    const reply = flags[index];
    return reply !== true && reply !== 1;
  });
}

/** Records ids as notified. Call ONLY after Telegram confirmed delivery. */
export async function markNotified(products: Product[]): Promise<void> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    const id = product.id.trim();
    if (id !== "" && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  if (ids.length === 0) return;

  const redis = await connectRedis();
  await redis.sAdd(NOTIFIED_KEY, ids);
}
