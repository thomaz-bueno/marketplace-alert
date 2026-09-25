import { findAllAlerts } from "../alerts";
import { dedupeProducts } from "./dedupe";
import { getProducts } from "./store";
import type { Product } from "./types";

function createdAtTime(product: Product): number {
  const time = Date.parse(product.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

export async function listProducts(): Promise<Product[]> {
  const alerts = await findAllAlerts();

  const products: Product[] = [];
  for (const alert of alerts) {
    products.push(...(await getProducts(alert.id)));
  }

  return dedupeProducts(products).sort(
    (a, b) => createdAtTime(b) - createdAtTime(a),
  );
}
