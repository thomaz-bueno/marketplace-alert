import { closePool } from "../infrastructure/postgres/pool";
import {
  createAlert,
  deleteAlert,
  findAllAlerts,
  findAlertById,
  updateAlert,
  validateAlertInput,
} from "../modules/alerts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main(): Promise<void> {
  const invalid = validateAlertInput({ product_name: "  ", city: "", max_price: -1 });
  assert(invalid.ok === false, "invalid input must be rejected");
  assert(
    !invalid.ok && invalid.errors.length === 3,
    "invalid input must report 3 errors",
  );

  const valid = validateAlertInput({
    product_name: "iPhone 13",
    city: "Bauru",
    max_price: "2000",
  });
  if (!valid.ok) {
    throw new Error(`valid input rejected: ${valid.errors.join(", ")}`);
  }
  const input = valid.value;

  const created = await createAlert(input);
  assert(created.id > 0, "created alert has id");
  assert(created.productName === "iPhone 13", "created productName");
  assert(created.city === "Bauru", "created city");
  assert(created.maxPrice === 2000, "created maxPrice");
  console.log("create:", created);

  const fetched = await findAlertById(created.id);
  if (!fetched) throw new Error("created alert cannot be read by id");
  assert(fetched.id === created.id, "read returns same id");
  console.log("read:  ", fetched);

  const list = await findAllAlerts();
  assert(
    list.some((alert) => alert.id === created.id),
    "list contains created alert",
  );
  console.log(`list:   ${list.length} alert(s), created alert present`);

  const updated = await updateAlert(created.id, {
    productName: "iPhone 13 128GB",
    city: "Bauru - SP",
    maxPrice: 1800,
  });
  if (!updated) throw new Error("update did not return the alert");
  assert(updated.productName === "iPhone 13 128GB", "updated productName");
  assert(updated.city === "Bauru - SP", "updated city");
  assert(updated.maxPrice === 1800, "updated maxPrice");
  assert(updated.updatedAt >= updated.createdAt, "updatedAt refreshed");
  console.log("update:", updated);

  const missing = await findAlertById(99_999_999);
  assert(missing === null, "unknown id returns null");
  const missingUpdate = await updateAlert(99_999_999, input);
  assert(missingUpdate === null, "update of unknown id returns null");

  const deleted = await deleteAlert(created.id);
  assert(deleted === true, "delete returns true");
  const afterDelete = await findAlertById(created.id);
  assert(afterDelete === null, "deleted alert is gone");
  const deletedAgain = await deleteAlert(created.id);
  assert(deletedAgain === false, "second delete returns false");
  console.log("delete: ok");

  console.log("\nALERTS CRUD CHECK: PASS");
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (error: unknown) => {
    console.error("\nALERTS CRUD CHECK: FAIL");
    console.error(error);
    await closePool();
    process.exit(1);
  });
