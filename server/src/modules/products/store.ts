import { connectRedis } from "../../infrastructure/redis/client";
import { dedupeProducts } from "./dedupe";
import { deserializeProduct, serializeProduct } from "./serialization";
import type { Product } from "./types";

const PRODUCTS_KEY_PATTERN = "alert:*:products";
const SCAN_COUNT = 100;

export function alertProductsKey(alertId: number): string {
  if (!Number.isInteger(alertId) || alertId <= 0) {
    throw new Error(`Invalid alert id: ${alertId}`);
  }
  return `alert:${alertId}:products`;
}

function readHash(hash: Record<string, string>): Product[] {
  const products: Product[] = [];
  for (const raw of Object.values(hash)) {
    const product = deserializeProduct(raw);
    if (product) products.push(product);
  }
  return products;
}

export async function saveProducts(
  alertId: number,
  products: Product[],
): Promise<number> {
  const key = alertProductsKey(alertId);
  const unique = dedupeProducts(products).filter((product) => product.id.trim() !== "");

  const redis = await connectRedis();
  const multi = redis.multi();
  multi.del(key);

  if (unique.length > 0) {
    const hash: Record<string, string> = {};
    for (const product of unique) {
      hash[product.id] = serializeProduct(product);
    }
    multi.hSet(key, hash);
  }

  await multi.exec();
  return unique.length;
}

export async function getProducts(alertId: number): Promise<Product[]> {
  const redis = await connectRedis();
  const hash = await redis.hGetAll(alertProductsKey(alertId));
  return readHash(hash);
}

export async function getAllProducts(): Promise<Product[]> {
  const redis = await connectRedis();

  const keys: string[] = [];
  let cursor = 0;
  do {
    const page = await redis.scan(cursor, {
      MATCH: PRODUCTS_KEY_PATTERN,
      COUNT: SCAN_COUNT,
    });
    cursor = page.cursor;
    keys.push(...page.keys);
  } while (cursor !== 0);

  const products: Product[] = [];
  for (const key of keys) {
    const hash = await redis.hGetAll(key);
    products.push(...readHash(hash));
  }

  return dedupeProducts(products);
}

export async function clearAllProducts(): Promise<number> {
  const redis = await connectRedis();

  const keys: string[] = [];
  let cursor = 0;
  do {
    const page = await redis.scan(cursor, {
      MATCH: PRODUCTS_KEY_PATTERN,
      COUNT: SCAN_COUNT,
    });
    cursor = page.cursor;
    keys.push(...page.keys);
  } while (cursor !== 0);

  if (keys.length === 0) return 0;
  return (await redis.del(keys)) ?? 0;
}
