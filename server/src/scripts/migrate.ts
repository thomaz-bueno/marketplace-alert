import { runMigrations } from "../infrastructure/postgres/migrations";
import { closePool } from "../infrastructure/postgres/pool";

runMigrations()
  .then(async () => {
    console.log("[migrations] up to date");
    await closePool();
  })
  .catch(async (error: unknown) => {
    console.error("[migrations] failed:", error);
    await closePool();
    process.exit(1);
  });
