import type { AlertInput } from "./types";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const MAX_PRICE_LIMIT = 10_000_000_000;

function pickField(data: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (data[name] !== undefined) return data[name];
  }
  return undefined;
}

function readRequiredString(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${field} is required`;
  }
  return null;
}

function parseMaxPrice(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

function readMaxPriceError(value: unknown): string | null {
  const price = parseMaxPrice(value);
  if (!Number.isFinite(price)) return "maxPrice must be a valid number";
  if (price < 0) return "maxPrice must not be negative";
  if (price > MAX_PRICE_LIMIT) return "maxPrice is too large";
  return null;
}

export function validateAlertInput(input: unknown): ValidationResult<AlertInput> {
  const data = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  const productName = pickField(data, "productName", "product_name");
  const city = pickField(data, "city");
  const maxPrice = pickField(data, "maxPrice", "max_price");

  const errors = [
    readRequiredString(productName, "productName"),
    readRequiredString(city, "city"),
    readMaxPriceError(maxPrice),
  ].filter((error): error is string => error !== null);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      productName: (productName as string).trim(),
      city: (city as string).trim(),
      maxPrice: parseMaxPrice(maxPrice),
    },
  };
}

export function validateAlertId(input: unknown): ValidationResult<number> {
  const id = typeof input === "string" && input.trim() !== "" ? Number(input) : input;

  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return { ok: false, errors: ["id must be a positive integer"] };
  }
  return { ok: true, value: id };
}
