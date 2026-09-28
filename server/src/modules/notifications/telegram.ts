import { config } from "../../config";
import type { Product } from "../products";
import { buildProductCaption, buildTextPartitions } from "./format";

const API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 10_000;
const ALBUM_SIZE = 10;
const MAX_PRODUCTS = 30;

/**
 * Bounded, predictable retry policy for one notification. Every limit is a
 * fixed documented value (no exponential backoff, no unbounded waiting):
 * each message part gets at most `maxAttempts` attempts with `retryDelayMs`
 * between them; a 429 `retry_after` is honored only up to
 * `maxRateLimitWaitMs` (longer rate limits defer to the next scheduled
 * cycle); and retries never wait more than `retryBudgetMs` in total per
 * notification, so Telegram cannot hold the scheduler lock indefinitely.
 */
export const RETRY_LIMITS = {
  maxAttempts: 3,
  retryDelayMs: 1_000,
  maxRateLimitWaitMs: 5_000,
  retryBudgetMs: 60_000,
} as const;

/** Test seam for the time-based limits; production uses RETRY_LIMITS. */
export type TelegramDeliveryOptions = {
  /** Fixed wait between attempts (default RETRY_LIMITS.retryDelayMs). */
  retryDelayMs?: number;
  /** Total retry waiting allowed for one notification (default RETRY_LIMITS.retryBudgetMs). */
  retryBudgetMs?: number;
};

export type TelegramSendResult =
  | { status: "sent"; products: number; apiCalls: number }
  | {
      status: "partial";
      products: number;
      apiCalls: number;
      /** Ids Telegram confirmed; recorded immediately so they are never resent. */
      deliveredIds: string[];
      error: string;
    }
  | { status: "skipped"; reason: "empty batch" | "not configured" };

/**
 * Failure classes used to decide whether retrying can help. Only
 * `network`, `timeout`, `rate_limit` and `server` are retryable;
 * `auth` (invalid token/chat id) and `bad_request` (invalid message
 * formatting or unsupported media) are permanent for the current payload.
 */
export type TelegramErrorCategory =
  | "network"
  | "timeout"
  | "rate_limit"
  | "server"
  | "auth"
  | "bad_request"
  | "unknown";

export class TelegramError extends Error {
  /** Whether a later retry (same cycle or next attempt) could succeed. */
  readonly retryable: boolean;
  readonly category: TelegramErrorCategory;
  /** The wait requested by a 429 response, when Telegram provided one. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      category?: TelegramErrorCategory;
      retryAfterMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "TelegramError";
    this.retryable = options.retryable ?? false;
    this.category = options.category ?? "unknown";
    this.retryAfterMs = options.retryAfterMs;
  }
}

type TelegramResponse = {
  ok?: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

function readRetryAfterMs(body: TelegramResponse | null): number | undefined {
  const seconds = body?.parameters?.retry_after;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const match = body?.description?.match(/retry after (\d+)/i);
  if (match) return Number(match[1]) * 1000;
  return undefined;
}

function classifyHttp(
  status: number,
  errorCode: number,
): { category: TelegramErrorCategory; retryable: boolean } {
  if (errorCode === 429) return { category: "rate_limit", retryable: true };
  if (status >= 500) return { category: "server", retryable: true };
  if (status === 401 || status === 403) return { category: "auth", retryable: false };
  if (status === 400 || status === 422) return { category: "bad_request", retryable: false };
  return { category: "unknown", retryable: false };
}

/**
 * One Bot API call. The token only ever lives in the request URL; errors
 * carry the method name, HTTP status, Telegram's own description and the
 * failure category — never the URL, the token, or the chat id.
 */
async function apiCall<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const url = `${API_BASE}/bot${config.telegramBotToken}/${method}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new TelegramError(
      timedOut
        ? `telegram ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `telegram ${method} failed: network error`,
      {
        retryable: true,
        category: timedOut ? "timeout" : "network",
        cause: error,
      },
    );
  }

  let body: TelegramResponse | null = null;
  try {
    body = (await response.json()) as TelegramResponse;
  } catch {
    body = null;
  }

  if (!response.ok || body?.ok !== true) {
    const status = response.status;
    const errorCode = body?.error_code ?? status;
    const description =
      body?.description ?? (body === null ? "invalid JSON response" : "unknown error");
    const { category, retryable } = classifyHttp(status, errorCode);
    throw new TelegramError(
      `telegram ${method} failed (HTTP ${status}, code ${errorCode}): ${description}`,
      { retryable, category, retryAfterMs: readRetryAfterMs(body) },
    );
  }

  return body.result as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withNote(error: TelegramError, note: string): TelegramError {
  return new TelegramError(`${error.message}; ${note}`, {
    retryable: error.retryable,
    category: error.category,
    retryAfterMs: error.retryAfterMs,
    cause: error,
  });
}

type RetryRunner = (label: string, action: () => Promise<void>) => Promise<void>;

/**
 * Local retry helper (no framework): runs one delivery attempt, and on a
 * retryable failure waits a bounded delay and tries again. Every decision is
 * logged as a single `[telegram]` line with the operation, attempt number,
 * error category, batch size and what happens next — never the token, the
 * chat id, or the payload.
 */
function createRetryRunner(options: {
  batch: number;
  retryDelayMs: number;
  retryBudgetMs: number;
}): RetryRunner {
  let waitedMs = 0;

  return async function runAttempt(
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await action();
        return;
      } catch (error) {
        if (!(error instanceof TelegramError)) throw error;

        const base =
          `[telegram] ${label} attempt ${attempt}/${RETRY_LIMITS.maxAttempts} failed ` +
          `(category=${error.category}, batch=${options.batch} products): ${error.message}`;

        if (!error.retryable) {
          console.warn(`${base}; not retrying (permanent error)`);
          throw error;
        }
        if (attempt >= RETRY_LIMITS.maxAttempts) {
          console.warn(`${base}; giving up after ${RETRY_LIMITS.maxAttempts} attempts`);
          throw withNote(error, `giving up after ${RETRY_LIMITS.maxAttempts} attempts`);
        }

        let waitMs = options.retryDelayMs;
        if (error.category === "rate_limit" && error.retryAfterMs !== undefined) {
          if (error.retryAfterMs > RETRY_LIMITS.maxRateLimitWaitMs) {
            console.warn(
              `${base}; retry_after=${error.retryAfterMs}ms exceeds the ` +
                `${RETRY_LIMITS.maxRateLimitWaitMs}ms in-cycle limit; deferring to the next cycle`,
            );
            throw withNote(
              error,
              `rate limit of ${error.retryAfterMs}ms exceeds the ` +
                `${RETRY_LIMITS.maxRateLimitWaitMs}ms in-cycle limit; deferring to the next cycle`,
            );
          }
          waitMs = error.retryAfterMs;
        }
        if (waitedMs + waitMs > options.retryBudgetMs) {
          console.warn(
            `${base}; retry budget of ${options.retryBudgetMs}ms exhausted; ` +
              "deferring to the next cycle",
          );
          throw withNote(
            error,
            `retry budget of ${options.retryBudgetMs}ms exhausted; deferring to the next cycle`,
          );
        }

        console.warn(`${base}; retrying in ${waitMs}ms`);
        await sleep(waitMs);
        waitedMs += waitMs;
      }
    }
  };
}

async function sendAlbum(chunk: Product[]): Promise<void> {
  await apiCall("sendMediaGroup", {
    chat_id: config.telegramChatId,
    media: chunk.map((product, index) => ({
      type: "photo",
      media: product.image,
      caption: buildProductCaption(product, { heading: index === 0 }),
      parse_mode: "HTML",
    })),
  });
}

async function sendPhoto(product: Product): Promise<void> {
  await apiCall("sendPhoto", {
    chat_id: config.telegramChatId,
    photo: product.image,
    caption: buildProductCaption(product, { heading: true }),
    parse_mode: "HTML",
  });
}

async function sendMessage(text: string): Promise<void> {
  await apiCall("sendMessage", {
    chat_id: config.telegramChatId,
    text,
    parse_mode: "HTML",
  });
}

/**
 * Whether an HTML text message can still deliver products the failing
 * method could not: content problems (`bad_request`/`unknown`) are dodged
 * by text, and a method-specific `server` error is worth one last resort.
 * Auth failures, rate limits and connection problems would hit the text
 * path identically, so they are not worth pointless extra attempts.
 */
function canFallbackAsText(error: TelegramError): boolean {
  if (error.category === "auth" || error.category === "rate_limit") return false;
  if (error.retryable) return error.category === "server";
  return true;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type DeliveryPart = {
  label: string;
  products: Product[];
  send: () => Promise<void>;
  /** Text parts run instead when this part fails and text can deliver it. */
  fallback?: () => DeliveryPart[];
};

/**
 * Sends one logical notification for a batch of new products, with bounded
 * in-cycle retries (see RETRY_LIMITS).
 *
 * Products with an image go out as Telegram albums (sendMediaGroup, up to 10
 * photos; a lone photo uses sendPhoto) with the details in each caption;
 * products without an image — and albums Telegram refuses — are delivered as
 * HTML text messages, so no product is dropped because of its image. The
 * batch is capped at MAX_PRODUCTS to keep API calls bounded within a cycle.
 *
 * Retry semantics: each message part is retried only for temporary failures
 * (network, timeout, 5xx, 429 honoring retry_after up to the in-cycle
 * limit); permanent errors (invalid token/chat id, invalid request data)
 * fail immediately. Known results are never resent: parts Telegram
 * confirmed are tracked, so a later failure returns `partial` with the
 * delivered ids instead of discarding them; TelegramError is thrown only
 * when nothing was delivered. A timeout or lost response after Telegram may
 * already have accepted a message is ambiguous and can be sent again on a
 * later cycle — delivery is at-least-once, never exactly-once.
 */
export async function sendProductNotification(
  products: Product[],
  options: TelegramDeliveryOptions = {},
): Promise<TelegramSendResult> {
  if (!config.telegramEnabled) {
    return { status: "skipped", reason: "not configured" };
  }
  if (products.length === 0) {
    return { status: "skipped", reason: "empty batch" };
  }

  let batch = products;
  if (batch.length > MAX_PRODUCTS) {
    console.warn(
      `[telegram] ${batch.length} new products exceed the notification cap; ` +
        `sending the first ${MAX_PRODUCTS}`,
    );
    batch = batch.slice(0, MAX_PRODUCTS);
  }

  const retryDelayMs = options.retryDelayMs ?? RETRY_LIMITS.retryDelayMs;
  const retryBudgetMs = options.retryBudgetMs ?? RETRY_LIMITS.retryBudgetMs;
  const runAttempt = createRetryRunner({ batch: batch.length, retryDelayMs, retryBudgetMs });

  let apiCalls = 0;
  const counted = <T>(action: () => Promise<T>): (() => Promise<T>) => {
    return async () => {
      apiCalls += 1;
      return action();
    };
  };

  const textParts = (targets: Product[]): DeliveryPart[] =>
    buildTextPartitions(targets)
      .filter((partition) => partition.products.length > 0)
      .map((partition) => ({
        label: "sendMessage",
        products: partition.products,
        send: counted(() => sendMessage(partition.text)),
      }));

  const withImage = batch.filter((product) => product.image.trim() !== "");
  const withoutImage = batch.filter((product) => product.image.trim() === "");

  const queue: DeliveryPart[] = [];
  for (const group of chunk(withImage, ALBUM_SIZE)) {
    const label = group.length === 1 ? "sendPhoto" : "sendMediaGroup";
    const send = counted(
      group.length === 1 ? () => sendPhoto(group[0]) : () => sendAlbum(group),
    );
    queue.push({ label, products: group, send, fallback: () => textParts(group) });
  }
  queue.push(...textParts(withoutImage));

  const delivered: Product[] = [];

  for (let index = 0; index < queue.length; index++) {
    const part = queue[index];
    try {
      await runAttempt(part.label, part.send);
      delivered.push(...part.products);
      continue;
    } catch (error) {
      if (
        error instanceof TelegramError &&
        part.fallback !== undefined &&
        canFallbackAsText(error)
      ) {
        console.warn(
          `[telegram] ${part.label} failed (${error.message}); ` +
            `sending ${part.products.length} product(s) as text instead`,
        );
        const replacements = part.fallback();
        if (replacements.length > 0) {
          queue.splice(index, 1, ...replacements);
          index -= 1;
          continue;
        }
      }

      const errorText =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (delivered.length > 0) {
        return {
          status: "partial",
          products: delivered.length,
          apiCalls,
          deliveredIds: delivered.map((product) => product.id),
          error: errorText,
        };
      }
      throw error;
    }
  }

  return { status: "sent", products: delivered.length, apiCalls };
}
