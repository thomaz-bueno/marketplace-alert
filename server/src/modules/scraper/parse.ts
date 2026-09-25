import { parsePrice } from "./price";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Raw anchor data collected from the rendered search results page. */
export type RawCard = {
  href: string;
  spans: string[];
  image: string;
};

export type ListingCandidate = {
  id: string;
  url: string;
  title: string;
  priceText: string;
  location: string;
  image: string;
};

export type ListingDetail = {
  title: string;
  priceText: string;
  priceAmount: number | null;
  location: string;
  description: string;
  seller: string;
  createdAt: string;
};

/**
 * Parses one search card. Observed on the real rendered page:
 * - href: "/marketplace/item/<id>/?ref=search..." (id and canonical URL)
 * - spans (dir="auto"): [badge?, price, oldPrice?, title, location]
 * The last two spans are always title and location; the current price is the
 * first parseable span before them.
 */
export function parseCard(raw: RawCard): ListingCandidate | null {
  const id = raw.href.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? "";
  if (id === "") return null;

  const spans = raw.spans.map((span) => span.trim()).filter((span) => span !== "");
  if (spans.length < 3) return null;

  const location = spans[spans.length - 1];
  const title = spans[spans.length - 2];
  const priceText =
    spans.slice(0, spans.length - 2).find((span) => parsePrice(span) !== null) ?? "";

  return {
    id,
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    title,
    priceText,
    location,
    image: raw.image,
  };
}

/**
 * Finds the Marketplace details object inside the server-rendered JSON payload
 * (the visible detail DOM does not render for logged-out sessions; the payload
 * does). Structure inspected on the real page:
 * require[0][3][0].__bbox.require[...].__bbox.result.data.viewer
 *   .marketplace_product_details_page.target
 */
function findDetailsPage(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 40 || !isRecord(node)) return null;
  const candidate = node["marketplace_product_details_page"];
  if (isRecord(candidate)) return candidate;
  for (const value of Object.values(node)) {
    const found = findDetailsPage(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Parses the embedded detail payload script into listing detail fields. */
export function parseDetailScript(scriptText: string): ListingDetail | null {
  let data: unknown;
  try {
    data = JSON.parse(scriptText);
  } catch {
    return null;
  }

  const detailsPage = findDetailsPage(data);
  if (!detailsPage) return null;

  const renderable = isRecord(detailsPage["marketplace_listing_renderable_target"])
    ? (detailsPage["marketplace_listing_renderable_target"] as Record<string, unknown>)
    : null;
  const target = isRecord(detailsPage["target"])
    ? (detailsPage["target"] as Record<string, unknown>)
    : renderable;
  if (!target) return null;

  const title =
    readString(target["marketplace_listing_title"]) ||
    readString(renderable?.["marketplace_listing_title"]);
  if (title === "") return null;

  const price = isRecord(target["listing_price"])
    ? (target["listing_price"] as Record<string, unknown>)
    : null;
  const priceText =
    readString(price?.["formatted_amount_zeros_stripped"]) ||
    readString(price?.["formatted_amount"]);
  const rawAmount = price?.["amount"];
  const parsedAmount = typeof rawAmount === "string" ? Number(rawAmount) : null;
  const priceAmount =
    parsedAmount !== null && Number.isFinite(parsedAmount) && parsedAmount >= 0
      ? parsedAmount
      : null;

  const locationText = isRecord(target["location_text"])
    ? readString((target["location_text"] as Record<string, unknown>)["text"])
    : "";
  const description = isRecord(target["redacted_description"])
    ? readString((target["redacted_description"] as Record<string, unknown>)["text"])
    : "";

  const creationTime = target["creation_time"];
  const createdAt =
    typeof creationTime === "number" && Number.isFinite(creationTime) && creationTime > 0
      ? new Date(creationTime * 1000).toISOString()
      : "";

  // Logged-out sessions receive `marketplace_listing_seller: null`.
  const sellerField = target["marketplace_listing_seller"];
  const seller =
    typeof sellerField === "string"
      ? sellerField
      : isRecord(sellerField)
        ? readString(sellerField["name"])
        : "";

  return {
    title,
    priceText,
    priceAmount,
    location: locationText,
    description,
    seller,
    createdAt,
  };
}
