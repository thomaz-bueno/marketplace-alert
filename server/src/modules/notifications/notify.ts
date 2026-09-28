import type { Product } from "../products";
import { sendProductNotification } from "./telegram";
import { filterNotified, markNotified } from "./tracking";

/**
 * Outcome of the cycle's single logical notification.
 * `products` = delivered count when sent, attempted count when failed,
 * always 0 when skipped. `delivered` = products Telegram confirmed before a
 * failure (0 when nothing is known to have arrived). `error`/`reason` never
 * contain secrets.
 */
export type NotificationOutcome =
  | { status: "sent"; products: number }
  | { status: "skipped"; products: 0; reason: string }
  | { status: "failed"; products: number; delivered: number; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Sends ONE logical notification for the accumulated products of a cycle.
 *
 * Pipeline: filter out ids already notified in a previous cycle -> skip
 * without any Telegram call when nothing is new -> send one batch through
 * the Telegram service (bounded in-cycle retries, see telegram.ts) -> record
 * confirmed ids only after Telegram acknowledged them (2xx), so failed or
 * ambiguous parts are retried naturally next cycle (at-least-once, see
 * tracking.ts). A partial delivery records the confirmed parts and reports
 * the rest as failed with `delivered > 0` — known successes are never
 * resent.
 *
 * Never throws: tracking and delivery problems are reported as `failed` so
 * the scraping cycle and future scheduler runs keep working, and the final
 * failure is logged without secrets.
 */
export async function notifyNewProducts(
  products: Product[],
): Promise<NotificationOutcome> {
  if (products.length === 0) {
    return { status: "skipped", products: 0, reason: "no new products" };
  }

  let fresh: Product[];
  try {
    fresh = await filterNotified(products);
  } catch (error) {
    const message = `tracking: ${errorMessage(error)}`;
    console.error(
      `[notify] notification failed (batch=${products.length} products, delivered=0): ${message}`,
    );
    return { status: "failed", products: products.length, delivered: 0, error: message };
  }

  if (fresh.length === 0) {
    return { status: "skipped", products: 0, reason: "already notified" };
  }

  try {
    const result = await sendProductNotification(fresh);
    if (result.status === "skipped") {
      return { status: "skipped", products: 0, reason: result.reason };
    }

    if (result.status === "partial") {
      const deliveredIds = new Set(result.deliveredIds);
      try {
        await markNotified(fresh.filter((product) => deliveredIds.has(product.id)));
      } catch (error) {
        console.warn(
          `[notify] partial delivery confirmed but recording failed (${errorMessage(error)}); ` +
            "these products may be sent again next cycle",
        );
      }
      console.error(
        `[notify] notification partially delivered (batch=${fresh.length} products, ` +
          `delivered=${result.products}): ${result.error}; ` +
          "the remaining products are retried next cycle",
      );
      return {
        status: "failed",
        products: fresh.length,
        delivered: result.products,
        error: result.error,
      };
    }

    // sendProductNotification caps the batch, so only the ids it reported as
    // delivered are recorded (an uncapped remainder stays "new" for later).
    try {
      await markNotified(fresh.slice(0, result.products));
    } catch (error) {
      console.warn(
        `[notify] delivery confirmed but recording failed (${errorMessage(error)}); ` +
          "these products may be sent again next cycle",
      );
    }
    return { status: "sent", products: result.products };
  } catch (error) {
    const message = errorMessage(error);
    console.error(
      `[notify] notification failed (batch=${fresh.length} products, delivered=0): ${message}`,
    );
    return { status: "failed", products: fresh.length, delivered: 0, error: message };
  }
}
