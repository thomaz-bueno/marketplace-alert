import type { Product } from "./types";

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    let normalized = parsed.toString();
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/\s+/g, "");
  }
}

function productKeys(product: Product): string[] {
  const keys: string[] = [];

  const id = product.id.trim();
  if (id !== "") keys.push(`id:${id}`);

  const url = normalizeUrl(product.url);
  if (url !== "") keys.push(`url:${url}`);

  return keys;
}

export function dedupeProducts(products: Product[]): Product[] {
  const seen = new Set<string>();
  const result: Product[] = [];

  for (const product of products) {
    const keys = productKeys(product);
    if (keys.length === 0 || keys.some((key) => seen.has(key))) continue;

    for (const key of keys) seen.add(key);
    result.push(product);
  }

  return result;
}
