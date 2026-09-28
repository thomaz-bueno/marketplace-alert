import type { Product } from "../products";

export const HEADING = "New Marketplace products found";

const TITLE_MAX = 160;
const LOCATION_MAX = 100;
const MAX_TEXT_MESSAGE_CHARS = 4000;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Escapes user-controlled text for Telegram's HTML parse mode. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Text block for one product: bold title, price (BRL, same format as the
 * web UI) with optional location, and the listing link when the URL exists.
 */
function productBlock(product: Product): string[] {
  const title = truncate(product.title.trim(), TITLE_MAX) || "(untitled listing)";
  const price = brl.format(product.price);
  const location = truncate(product.location.trim(), LOCATION_MAX);

  const lines = [`<b>${escapeHtml(title)}</b>`];
  lines.push(location === "" ? price : `${price} · ${escapeHtml(location)}`);

  const url = product.url.trim();
  if (url !== "") {
    lines.push(`<a href="${escapeHtml(url)}">Open listing</a>`);
  }
  return lines;
}

/**
 * Caption for one product inside a photo message / media-group item.
 * Telegram limits captions to 1024 characters; the truncation bounds above
 * keep the worst case (~450 characters) safely below that limit.
 */
export function buildProductCaption(
  product: Product,
  options: { heading?: boolean } = {},
): string {
  const lines: string[] = [];
  if (options.heading) lines.push(`<b>${HEADING}</b>`);
  lines.push(...productBlock(product));
  return lines.join("\n");
}

/** One text message and the products whose details it contains. */
export type TextPartition = {
  text: string;
  products: Product[];
};

/**
 * Splits products into text messages of at most ~4000 characters (Telegram's
 * sendMessage limit is 4096). Every message starts with the heading and a
 * product block is never split across messages. Each partition keeps its
 * product list so the delivery layer can track exactly which products a
 * confirmed (or failed) message covered.
 */
export function buildTextPartitions(products: Product[]): TextPartition[] {
  const heading = `<b>${HEADING}</b>`;
  const partitions: TextPartition[] = [];
  let current = heading;
  let currentProducts: Product[] = [];

  for (const product of products) {
    const block = productBlock(product).join("\n");
    if (current.length + block.length + 2 > MAX_TEXT_MESSAGE_CHARS) {
      partitions.push({ text: current, products: currentProducts });
      current = heading;
      currentProducts = [];
    }
    current += `\n\n${block}`;
    currentProducts.push(product);
  }

  partitions.push({ text: current, products: currentProducts });
  return partitions;
}
