import { closeRedis } from "../infrastructure/redis/client";
import {
  clearAllProducts,
  dedupeProducts,
  getAllProducts,
  getProducts,
  saveProducts,
  type Product,
} from "../modules/products";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function buildProduct(overrides: Partial<Product>): Product {
  return {
    id: "1001",
    title: "iPhone 13",
    price: 1800,
    location: "Bauru - SP",
    image: "https://cdn.example.com/1001.jpg",
    url: "https://www.facebook.com/marketplace/item/1001",
    seller: "João",
    description: "Bem conservado",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function main(): Promise<void> {
  await clearAllProducts();
  assert((await getAllProducts()).length === 0, "start from an empty collection");

  const p1 = buildProduct({ id: "1001", title: "iPhone 13", price: 1800 });
  const p2 = buildProduct({
    id: "1002",
    title: "iPhone 13 128GB",
    price: 1950,
    url: "https://www.facebook.com/marketplace/item/1002",
  });
  const p3 = buildProduct({
    id: "1003",
    title: "Apple iPhone 13",
    price: 1700,
    url: "https://www.facebook.com/marketplace/item/1003",
  });
  const duplicateOfP1 = buildProduct({
    id: "1001",
    title: "iPhone 13 (duplicado)",
    price: 9999,
    url: "https://www.facebook.com/marketplace/item/1001?mibextid=xyz",
  });

  const saved = await saveProducts(42, [p1, p2, p3, duplicateOfP1]);
  assert(saved === 3, `save must deduplicate (expected 3, got ${saved})`);
  console.log(`save:    4 received -> ${saved} stored for alert 42`);

  const fromAlert42 = await getProducts(42);
  assert(fromAlert42.length === 3, "retrieve products for one alert");
  assert(
    fromAlert42.every((product) => !product.title.includes("duplicado")),
    "duplicate id must not be stored",
  );
  const storedP1 = fromAlert42.find((product) => product.id === "1001");
  assert(storedP1?.price === 1800, "first occurrence wins on duplicates");
  console.log("get:     ", fromAlert42.map((product) => `${product.id} R$${product.price}`).join(", "));

  const urlOnlyDuplicate = buildProduct({
    id: "",
    title: "iPhone 13 via URL",
    url: "https://www.facebook.com/marketplace/item/1002?mibextid=abc",
  });
  const deduped = dedupeProducts([p1, duplicateOfP1, p2, urlOnlyDuplicate]);
  assert(deduped.length === 2, "dedupe by id and by normalized URL");
  console.log(`dedupe:  4 mixed entries -> ${deduped.length} unique`);

  const p4 = buildProduct({
    id: "2001",
    title: "MacBook Air M1",
    price: 3500,
    url: "https://www.facebook.com/marketplace/item/2001",
  });
  await saveProducts(43, [p4]);

  const all = await getAllProducts();
  assert(all.length === 4, `get all current products (expected 4, got ${all.length})`);
  assert(new Set(all.map((product) => product.id)).size === 4, "all products unique");
  console.log(`get all: ${all.length} products across alerts 42 and 43`);

  const replaced = await saveProducts(42, [p1]);
  assert(replaced === 1, "saving replaces the previous collection for the alert");
  assert((await getProducts(42)).length === 1, "old collection for alert 42 is gone");

  const cleared = await clearAllProducts();
  assert(cleared >= 2, `clear removes all product keys (removed ${cleared})`);
  assert((await getAllProducts()).length === 0, "collection is empty after clear");
  assert((await getProducts(42)).length === 0, "alert 42 is empty after clear");
  console.log(`clear:   ${cleared} key(s) removed, collection empty`);

  console.log("\nPRODUCTS REDIS CHECK: PASS");
}

main()
  .then(async () => {
    await closeRedis();
  })
  .catch(async (error: unknown) => {
    console.error("\nPRODUCTS REDIS CHECK: FAIL");
    console.error(error);
    await closeRedis();
    process.exit(1);
  });
