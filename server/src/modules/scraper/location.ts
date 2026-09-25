/**
 * Normalizes a city/location string so that common Marketplace
 * representations become equivalent:
 * "Bauru", "Bauru - SP", "Bauru, São Paulo", "Bauru/SP", "BAURU - SP".
 * State/country suffixes after the first "-", "," or "/" are dropped and
 * accents/case/whitespace are ignored. No radius or coordinates involved.
 */
export function normalizeCity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[-,/]/)[0]
    .replace(/\s+/g, " ")
    .trim();
}

/** True when both strings refer to the same city after normalization. */
export function matchesCity(location: string, city: string): boolean {
  const normalizedLocation = normalizeCity(location);
  const normalizedCity = normalizeCity(city);
  return (
    normalizedLocation !== "" &&
    normalizedCity !== "" &&
    normalizedLocation === normalizedCity
  );
}
