import type { Product } from "../modules/products";

type RecordedCall = {
  url: string;
  body: Record<string, unknown> | null;
  signal: AbortSignal | null | undefined;
};

type Responder = (call: RecordedCall) => Response | Promise<Response>;

let checks = 0;
let failures = 0;

function assert(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "111",
    title: "Bike Caloi 10",
    price: 450.9,
    location: "Bauru, SP",
    image: "https://scontent.example.fbcdn.net/x.jpg",
    url: "https://www.facebook.com/marketplace/item/111/",
    seller: "Ana",
    description: "",
    createdAt: "2026-09-28T10:00:00.000Z",
    ...overrides,
  };
}

function products(count: number, overrides: Partial<Product> = {}): Product[] {
  return Array.from({ length: count }, (_, index) =>
    product({
      id: String(1000 + index),
      url: `https://www.facebook.com/marketplace/item/${1000 + index}/`,
      ...overrides,
    }),
  );
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function main(): Promise<void> {
  process.env.TELEGRAM_BOT_TOKEN ??= "123456789:CHECKfakeTOKENcheck000000000000";
  process.env.TELEGRAM_CHAT_ID ??= "555123456";

  const { config } = await import("../config");
  const { sendProductNotification, TelegramError, HEADING } = await import(
    "../modules/notifications"
  );

  assert(config.telegramEnabled === true, "config enabled with fake-shaped env");

  const calls: RecordedCall[] = [];
  const ok: Responder = () => jsonResponse(200, { ok: true, result: true });
  let responder: Responder = ok;

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const call: RecordedCall = {
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      signal: init?.signal,
    };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;

  console.log("1) empty batch");
  const empty = await sendProductNotification([]);
  assert(empty.status === "skipped" && empty.reason === "empty batch", "returns skipped/empty batch");
  assert(calls.length === 0, "no API call for an empty batch");

  console.log("2) single product with image -> sendPhoto");
  const single = await sendProductNotification([product()]);
  assert(
    single.status === "sent" && single.products === 1 && single.apiCalls === 1,
    "typed success result",
  );
  assert(calls.length === 1 && calls[0].url.endsWith("/sendPhoto"), "uses sendPhoto");
  const photo = calls[0].body;
  assert(photo?.chat_id === config.telegramChatId, "chat id from config");
  assert(photo?.parse_mode === "HTML", "HTML parse mode");
  const photoCaption = String(photo?.caption ?? "");
  assert(photoCaption.length <= 1024, "caption within the 1024 limit");
  assert(photoCaption.includes(HEADING), "caption has the heading");
  assert(photoCaption.includes("Bike Caloi 10"), "caption has the title");
  assert(photoCaption.includes("450,90"), "price formatted as BRL like the web UI");
  assert(photoCaption.includes("Bauru, SP"), "caption has the location");
  assert(
    photoCaption.includes("https://www.facebook.com/marketplace/item/111/"),
    "caption links the listing",
  );
  assert(calls[0].signal instanceof AbortSignal, "request carries a timeout signal");

  console.log("3) HTML escaping of user-controlled text");
  await sendProductNotification([
    product({ title: 'Bike <b>azul</b> & "rara"', location: "São <Paulo>" }),
  ]);
  const escaped = String(calls[1].body?.caption ?? "");
  assert(!escaped.includes("<b>azul</b>"), "title tags are not injected raw");
  assert(
    escaped.includes("&lt;b&gt;azul&lt;/b&gt;") &&
      escaped.includes("&amp;") &&
      escaped.includes("&quot;rara&quot;") &&
      escaped.includes("São &lt;Paulo&gt;"),
    "entities escaped in title and location",
  );

  console.log("4) 10 products with images -> one sendMediaGroup");
  calls.length = 0;
  const ten = await sendProductNotification(products(10));
  assert(ten.status === "sent" && ten.apiCalls === 1, "one API call");
  assert(calls[0].url.endsWith("/sendMediaGroup"), "uses sendMediaGroup");
  const media = calls[0].body?.media;
  assert(Array.isArray(media) && media.length === 10, "10 media items");
  const captions = (media as Array<Record<string, unknown>>).map((item) =>
    String(item.caption),
  );
  assert(captions[0].includes(HEADING), "first caption has the heading");
  assert(!captions[1].includes(HEADING), "later captions stay per-product");
  assert(captions.every((caption) => caption.length <= 1024), "all captions within 1024");

  console.log("5) 11 products -> media group of 10 + lone sendPhoto");
  calls.length = 0;
  const eleven = await sendProductNotification(products(11));
  assert(eleven.status === "sent" && eleven.apiCalls === 2, "two API calls");
  assert(
    calls[0].url.endsWith("/sendMediaGroup") && calls[1].url.endsWith("/sendPhoto"),
    "chunk of 10 then single photo",
  );

  console.log("6) missing images -> text message, nothing dropped");
  calls.length = 0;
  const noImage = await sendProductNotification([
    product({ image: "" }),
    product({ image: "   " }),
  ]);
  assert(noImage.status === "sent" && noImage.products === 2, "both products reported sent");
  assert(
    calls.length === 1 && calls[0].url.endsWith("/sendMessage"),
    "exactly one sendMessage",
  );
  const text = String(calls[0].body?.text ?? "");
  assert(text.includes(HEADING) && text.includes("Bike Caloi 10"), "text keeps details");
  assert(text.length <= 4096, "within the sendMessage limit");

  console.log("7) undeliverable images fall back to text");
  calls.length = 0;
  responder = (call) =>
    call.url.endsWith("/sendMediaGroup")
      ? jsonResponse(400, {
          ok: false,
          error_code: 400,
          description: "Bad Request: failed to get HTTP URL content",
        })
      : jsonResponse(200, { ok: true, result: true });
  const fallback = await sendProductNotification(products(3));
  assert(fallback.status === "sent" && fallback.products === 3, "products preserved via fallback");
  assert(
    calls.length === 2 && calls[1].url.endsWith("/sendMessage"),
    "text fallback replaces the failed album",
  );
  responder = ok;

  console.log("8) HTTP 401 -> typed, non-retryable, secret-free error");
  calls.length = 0;
  responder = () => jsonResponse(401, { ok: false, error_code: 401, description: "Unauthorized" });
  const error401 = await captureError(sendProductNotification([product()]));
  assert(error401 instanceof TelegramError, "throws TelegramError");
  if (error401 instanceof TelegramError) {
    assert(error401.retryable === false, "401 is not retryable");
    assert(error401.category === "auth", "401 classified as auth");
    assert(error401.message.includes("401"), "message keeps the status code");
    assert(!error401.message.includes(config.telegramBotToken), "token never in the message");
    assert(!error401.message.includes(config.telegramChatId), "chat id never in the message");
  }
  assert(calls.length === 1, "permanent error attempted once, never retried");
  responder = ok;

  console.log("9) HTTP 429 -> retryable error, long rate limit deferred");
  calls.length = 0;
  responder = () =>
    jsonResponse(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 30" });
  const error429 = await captureError(sendProductNotification([product()]));
  assert(error429 instanceof TelegramError && error429.retryable === true, "429 is retryable");
  if (error429 instanceof TelegramError) {
    assert(error429.category === "rate_limit", "429 classified as rate_limit");
    assert(error429.retryAfterMs === 30000, "retry_after parsed from the description");
    assert(
      error429.message.includes("deferring to the next cycle"),
      "30s wait exceeds the in-cycle limit and defers",
    );
  }
  assert(calls.length === 1, "deferred instead of hammering Telegram");
  responder = ok;

  console.log("10) network failure -> retryable error, bounded attempts");
  calls.length = 0;
  responder = () => {
    throw new TypeError("fetch failed");
  };
  const errorNetwork = await captureError(
    sendProductNotification([product()], { retryDelayMs: 5 }),
  );
  assert(errorNetwork instanceof TelegramError && errorNetwork.retryable === true, "network error is retryable");
  if (errorNetwork instanceof TelegramError) {
    assert(errorNetwork.category === "network", "classified as network");
    assert(errorNetwork.message.includes("network error"), "safe network message");
    assert(
      errorNetwork.message.includes("giving up after 3 attempts"),
      "exhaustion stated in the message",
    );
    assert(!errorNetwork.message.includes(config.telegramBotToken), "token never in the message");
  }
  assert(calls.length === 3, "exactly maxAttempts calls, then stop");
  responder = ok;

  console.log("11) notification cap (35 products -> first 30)");
  calls.length = 0;
  const many = await sendProductNotification(products(35));
  assert(many.status === "sent" && many.products === 30, "cap applied");
  assert(calls.length === 3, "three albums of 10");
  const mediaItems = calls.reduce((total, call) => {
    const media = call.body?.media;
    return total + (Array.isArray(media) ? media.length : 0);
  }, 0);
  assert(mediaItems === 30, "exactly 30 photos sent");

  console.log("12) long text batches split at the size limit");
  calls.length = 0;
  const bulky = products(8, {
    image: "",
    title: "<".repeat(160),
    location: "&".repeat(100),
  });
  const longResult = await sendProductNotification(bulky);
  assert(longResult.status === "sent" && longResult.products === 8, "all products sent");
  const texts = calls.filter((call) => call.url.endsWith("/sendMessage"));
  assert(texts.length >= 2, "split into multiple messages");
  assert(
    texts.every((call) => String(call.body?.text ?? "").length <= 4000),
    "every message within 4000 characters",
  );
  assert(
    texts.every((call) => String(call.body?.text ?? "").includes(HEADING)),
    "every message carries the heading",
  );

  console.log(`\n${checks} checks, ${failures} failures`);
  if (failures > 0) {
    console.error("TELEGRAM CHECK: FAIL");
    process.exit(1);
  }
  console.log("TELEGRAM CHECK: PASS");
}

main().catch((error: unknown) => {
  console.error("TELEGRAM CHECK: FAIL");
  console.error(error);
  process.exit(1);
});
