export type { Product } from "./types";
export { dedupeProducts } from "./dedupe";
export { serializeProduct, deserializeProduct } from "./serialization";
export {
  alertProductsKey,
  saveProducts,
  getProducts,
  getAllProducts,
  clearAllProducts,
} from "./store";
export { productsRouter } from "./routes";
