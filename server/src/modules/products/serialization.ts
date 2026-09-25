import type { Product } from "./types";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function toProduct(value: unknown): Product | null {
  if (typeof value !== "object" || value === null) return null;

  const data = value as Record<string, unknown>;

  if (!isString(data.id) || data.id.trim() === "") return null;
  if (typeof data.price !== "number" || !Number.isFinite(data.price) || data.price < 0) {
    return null;
  }
  if (
    !isString(data.title) ||
    !isString(data.location) ||
    !isString(data.image) ||
    !isString(data.url) ||
    !isString(data.seller) ||
    !isString(data.description) ||
    !isString(data.createdAt)
  ) {
    return null;
  }

  return {
    id: data.id,
    title: data.title,
    price: data.price,
    location: data.location,
    image: data.image,
    url: data.url,
    seller: data.seller,
    description: data.description,
    createdAt: data.createdAt,
  };
}

export function serializeProduct(product: Product): string {
  return JSON.stringify(product);
}

export function deserializeProduct(raw: string): Product | null {
  try {
    return toProduct(JSON.parse(raw));
  } catch {
    return null;
  }
}
