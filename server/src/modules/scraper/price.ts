const CURRENCY_TOKENS = /R\$|US\$|CDN\$|AU\$|A\$|€|£|¥|\$/g;

function normalizeNumberToken(token: string): number | null {
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  let normalized = token;

  if (hasDot && hasComma) {
    // The last separator is the decimal mark ("1.800,00" and "1,800.00").
    normalized =
      token.lastIndexOf(",") > token.lastIndexOf(".")
        ? token.replace(/\./g, "").replace(",", ".")
        : token.replace(/,/g, "");
  } else if (hasComma) {
    const parts = token.split(",");
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      normalized = parts[0] + parts[1]; // "1,800" -> 1800
    } else if (parts.length === 2) {
      normalized = `${parts[0]}.${parts[1]}`; // "90,50" -> 90.50
    } else {
      normalized = token.replace(/,/g, "");
    }
  } else if (hasDot) {
    const parts = token.split(".");
    if (parts.length === 2 && parts[1].length === 3) {
      normalized = parts[0] + parts[1]; // "1.800" -> 1800
    } else if (parts.length > 2) {
      normalized = token.replace(/\./g, ""); // "1.800.000" -> 1800000
    }
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Parses a price out of a Marketplace price field, title or description.
 * Returns null when the text carries no reliable number.
 */
export function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(CURRENCY_TOKENS, " ");
  const match = cleaned.match(/\d[\d.,]*/);
  if (!match) return null;
  return normalizeNumberToken(match[0]);
}

/** Price extraction order: price field, then title, then description. */
export function extractPrice(
  priceField: string | null | undefined,
  title: string | null | undefined,
  description: string | null | undefined,
): number | null {
  return (
    parsePrice(priceField) ?? parsePrice(title) ?? parsePrice(description)
  );
}
