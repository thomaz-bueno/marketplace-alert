import { findAllAlerts, type Alert } from "../alerts";
import {
  clearAllProducts,
  dedupeProducts,
  saveProducts,
  type Product,
} from "../products";
import { matchesCity, scrapeAlert } from "../scraper";

export type ScrapeFn = (alert: Alert) => Promise<Product[]>;

export type CycleOptions = {
  trigger?: string;
  scrape?: ScrapeFn;
};

export type AlertCycleResult = {
  alertId: number;
  status: "saved" | "failed";
  products: number;
  error?: string;
};

export type CycleSummary = {
  cycleId: number;
  trigger: string;
  startedAt: string;
  durationMs: number;
  alerts: number;
  saved: number;
  failed: number;
  products: number;
  results: AlertCycleResult[];
};

export type CycleOutcome =
  | { status: "skipped"; reason: string }
  | { status: "completed"; summary: CycleSummary };

let running = false;
let cycleCounter = 0;

export function isCycleRunning(): boolean {
  return running;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Runs the scrapers for every alert. Kept as the single concurrency point so
 * a bounded pool can replace the unbounded allSettled later without touching
 * the rest of the cycle.
 */
async function scrapeAll(
  alerts: Alert[],
  scrape: ScrapeFn,
): Promise<PromiseSettledResult<Product[]>[]> {
  return Promise.allSettled(alerts.map((alert) => scrape(alert)));
}

/**
 * One complete scraping cycle: lock -> clear Redis -> load alerts ->
 * scrape (concurrently) -> isolate failures -> filter -> dedupe -> save ->
 * finish. Returns "skipped" when another cycle is still running (in-memory
 * lock, single process). Infrastructure failures (Redis/Postgres) reject so
 * callers can surface them; per-alert failures are isolated inside.
 */
export async function runCycle(options: CycleOptions = {}): Promise<CycleOutcome> {
  const trigger = options.trigger ?? "manual";

  if (running) {
    console.log(
      `[scheduler] cycle skipped (trigger=${trigger}, previous cycle still running)`,
    );
    return { status: "skipped", reason: "previous cycle still running" };
  }

  running = true;
  const cycleId = ++cycleCounter;
  const startedAt = new Date();

  try {
    console.log(`[scheduler] cycle #${cycleId} started (trigger=${trigger})`);

    const cleared = await clearAllProducts();
    const alerts = await findAllAlerts();
    console.log(
      `[scheduler] cycle #${cycleId} prepared (alerts=${alerts.length}, staleKeysCleared=${cleared})`,
    );

    const scrape = options.scrape ?? scrapeAlert;
    const settled = await scrapeAll(alerts, scrape);

    const results: AlertCycleResult[] = [];
    let productCount = 0;

    for (const [index, outcome] of settled.entries()) {
      const alert = alerts[index];

      if (outcome.status === "rejected") {
        const message = errorMessage(outcome.reason);
        results.push({ alertId: alert.id, status: "failed", products: 0, error: message });
        console.error(`[scheduler] cycle #${cycleId} alert ${alert.id} failed: ${message}`);
        continue;
      }

      const filtered = outcome.value.filter(
        (product) =>
          product.price <= alert.maxPrice && matchesCity(product.location, alert.city),
      );
      const unique = dedupeProducts(filtered);
      const saved = await saveProducts(alert.id, unique);

      productCount += saved;
      results.push({ alertId: alert.id, status: "saved", products: saved });
      console.log(`[scheduler] cycle #${cycleId} alert ${alert.id} -> ${saved} product(s)`);
    }

    const summary: CycleSummary = {
      cycleId,
      trigger,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      alerts: alerts.length,
      saved: results.filter((result) => result.status === "saved").length,
      failed: results.filter((result) => result.status === "failed").length,
      products: productCount,
      results,
    };

    console.log(
      `[scheduler] cycle #${cycleId} completed in ${summary.durationMs}ms: ` +
        JSON.stringify({
          trigger: summary.trigger,
          alerts: summary.alerts,
          saved: summary.saved,
          failed: summary.failed,
          products: summary.products,
        }),
    );

    return { status: "completed", summary };
  } catch (error) {
    console.error(`[scheduler] cycle #${cycleId} aborted:`, error);
    throw error;
  } finally {
    running = false;
  }
}
