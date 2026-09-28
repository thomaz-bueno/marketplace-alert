import type { Product } from "../modules/products";

type RecordedCall = {
  url: string;
  body: Record<string, unknown> | null;
};

type Responder = (call: RecordedCall, index: number) => Response | Promise<Response>;

type Scenario = {
  value: unknown;
  error: unknown;
  lines: string[];
};

let checks = 0;
let failures = 0;
const allLogLines: string[] = [];

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

/**
 * Runs one delivery attempt while capturing every log line it produces, so
 * the checks can assert on diagnostics (and the absence of secrets) without
 * polluting the script's own output.
 */
async function runScenario(fn: () => Promise<unknown>): Promise<Scenario> {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]): void => {
    lines.push(args.map(String).join(" "));
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  let value: unknown = null;
  let error: unknown = null;
  try {
    value = await fn();
  } catch (caught) {
    error = caught;
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  allLogLines.push(...lines);
  return { value, error, lines };
}

async function main(): Promise<void> {
  process.env.TELEGRAM_BOT_TOKEN = "123456789:RETRYcheckfakeTOKEN0000000000";
  process.env.TELEGRAM_CHAT_ID = "555777333";

  const { config } = await import("../config");
  const { RETRY_LIMITS, TelegramError, sendProductNotification } = await import(
    "../modules/notifications"
  );

  assert(config.telegramEnabled === true, "forced fake credentials enable Telegram");
  assert(RETRY_LIMITS.maxAttempts === 3, "attempt limit is a documented constant");

  const calls: RecordedCall[] = [];
  let responder: Responder = () => jsonResponse(200, { ok: true, result: true });
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const call: RecordedCall = {
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as typeof fetch;

  const httpError = (status: number, description: string): Response =>
    jsonResponse(status, { ok: false, error_code: status, description });
  const sent = (value: unknown): boolean =>
    typeof value === "object" && value !== null &&
    (value as { status?: string }).status === "sent";

  console.log("1) immediate success -> one attempt, no retry logging");
  calls.length = 0;
  const s1 = await runScenario(() => sendProductNotification([product()]));
  assert(s1.error === null && sent(s1.value), "sent on the first attempt");
  assert(calls.length === 1, "single API call");
  assert(s1.lines.length === 0, "nothing to log when nothing fails");

  console.log("2) temporary 500 then success -> retried within the cycle");
  calls.length = 0;
  responder = () =>
    calls.length === 1
      ? httpError(500, "Internal Server Error")
      : jsonResponse(200, { ok: true, result: true });
  const s2 = await runScenario(() =>
    sendProductNotification([product()], { retryDelayMs: 5 }),
  );
  assert(s2.error === null && sent(s2.value), "delivered on a later attempt");
  assert(calls.length === 2, "one failed attempt + one success");
  const retryLine = s2.lines.find((line) => line.includes("attempt 1/3"));
  assert(retryLine !== undefined, "failed attempt is logged");
  if (retryLine !== undefined) {
    assert(retryLine.includes("[telegram] sendPhoto"), "operation is logged");
    assert(retryLine.includes("category=server"), "error category is logged");
    assert(retryLine.includes("batch=1 products"), "batch size is logged");
    assert(retryLine.includes("retrying in"), "the next retry is announced");
  }

  console.log("3) persistent failure -> exactly maxAttempts attempts, then stop");
  calls.length = 0;
  responder = () => httpError(500, "Internal Server Error");
  const s3 = await runScenario(() =>
    sendProductNotification([product({ image: "" })], { retryDelayMs: 5 }),
  );
  assert(s3.error instanceof TelegramError, "throws after exhausting retries");
  if (s3.error instanceof TelegramError) {
    assert(s3.error.message.includes("500"), "status code kept in the message");
    assert(
      s3.error.message.includes(`giving up after ${RETRY_LIMITS.maxAttempts} attempts`),
      "exhaustion stated in the message",
    );
  }
  assert(
    calls.length === RETRY_LIMITS.maxAttempts,
    `exactly ${RETRY_LIMITS.maxAttempts} calls, no endless loop (got ${calls.length})`,
  );
  assert(
    s3.lines.some((line) => line.includes("giving up after 3 attempts")),
    "final outcome logged",
  );

  console.log("4) invalid credentials -> permanent, no pointless retries");
  calls.length = 0;
  responder = () => httpError(401, "Unauthorized");
  const s4 = await runScenario(() => sendProductNotification([product()]));
  assert(s4.error instanceof TelegramError, "throws TelegramError");
  if (s4.error instanceof TelegramError) {
    assert(s4.error.category === "auth", "classified as auth");
    assert(s4.error.retryable === false, "not retryable");
  }
  assert(calls.length === 1, "attempted exactly once");

  console.log("5) invalid request data -> permanent, no pointless retries");
  calls.length = 0;
  responder = () => httpError(400, "Bad Request: can't parse entities");
  const s5 = await runScenario(() => sendProductNotification([product({ image: "" })]));
  assert(s5.error instanceof TelegramError, "throws TelegramError");
  if (s5.error instanceof TelegramError) {
    assert(s5.error.category === "bad_request", "classified as bad_request");
    assert(s5.error.retryable === false, "not retryable");
  }
  assert(calls.length === 1, "attempted exactly once");

  console.log("6) rate limit with a short retry_after -> honored, then success");
  calls.length = 0;
  responder = (_call, index) =>
    index === 0
      ? jsonResponse(429, {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 1",
          parameters: { retry_after: 1 },
        })
      : jsonResponse(200, { ok: true, result: true });
  const startedAt = Date.now();
  const s6 = await runScenario(() => sendProductNotification([product()]));
  const elapsedMs = Date.now() - startedAt;
  assert(s6.error === null && sent(s6.value), "delivered after the rate limit");
  assert(calls.length === 2, "one rate-limited attempt + one success");
  assert(elapsedMs >= 900, `waited Telegram's retry_after (~1s, got ${elapsedMs}ms)`);

  console.log("7) rate limit longer than the in-cycle bound -> deferred, not hammered");
  calls.length = 0;
  responder = () =>
    jsonResponse(429, {
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry after 30",
      parameters: { retry_after: 30 },
    });
  const s7 = await runScenario(() => sendProductNotification([product()]));
  assert(s7.error instanceof TelegramError, "throws instead of waiting 30s");
  if (s7.error instanceof TelegramError) {
    assert(s7.error.retryable === true, "still retryable next cycle");
    assert(
      s7.error.message.includes("deferring to the next cycle"),
      "deferral explained in the message",
    );
  }
  assert(calls.length === 1, "no pointless hammering during a long rate limit");

  console.log("8) request timeout -> classified as timeout, bounded attempts");
  calls.length = 0;
  responder = () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
  };
  const s8 = await runScenario(() =>
    sendProductNotification([product({ image: "" })], { retryDelayMs: 5 }),
  );
  assert(s8.error instanceof TelegramError, "throws TelegramError");
  if (s8.error instanceof TelegramError) {
    assert(s8.error.category === "timeout", "classified as timeout");
    assert(s8.error.retryable === true, "timeout is retryable");
  }
  assert(calls.length === RETRY_LIMITS.maxAttempts, "bounded attempts for timeouts");

  console.log("9) partial delivery -> confirmed products reported, never lost");
  calls.length = 0;
  responder = (call) =>
    call.url.endsWith("/sendMessage")
      ? httpError(500, "Internal Server Error")
      : jsonResponse(200, { ok: true, result: true });
  const partialBatch = [
    product({ id: "part-a", title: "Partial A" }),
    product({ id: "part-b", title: "Partial B" }),
    product({ id: "part-c", title: "Partial C", image: "" }),
  ];
  const s9 = await runScenario(() =>
    sendProductNotification(partialBatch, { retryDelayMs: 5 }),
  );
  assert(s9.error === null, "partial delivery is a typed result, not a throw");
  const partial = s9.value as {
    status?: string;
    products?: number;
    apiCalls?: number;
    deliveredIds?: string[];
    error?: string;
  };
  assert(partial.status === "partial", "reported as partial");
  assert(partial.products === 2, `the two confirmed products counted (got ${partial.products})`);
  assert(partial.apiCalls === 4, `1 success + 3 attempts (got ${partial.apiCalls})`);
  assert(
    (partial.deliveredIds ?? []).join(",") === "part-a,part-b",
    "delivered ids are exactly the confirmed ones",
  );
  assert((partial.error ?? "").includes("500"), "the failing part kept its error");

  console.log("10) album exhausted -> text fallback still delivers the same products");
  calls.length = 0;
  responder = (call) =>
    call.url.endsWith("/sendMessage")
      ? jsonResponse(200, { ok: true, result: true })
      : httpError(500, "Internal Server Error");
  const s10 = await runScenario(() =>
    sendProductNotification([product({ id: "fb-1" }), product({ id: "fb-2" })], {
      retryDelayMs: 5,
    }),
  );
  assert(s10.error === null && sent(s10.value), "delivered via the text fallback");
  const s10result = s10.value as { products?: number; apiCalls?: number };
  assert(s10result.products === 2, "both products preserved");
  assert(s10result.apiCalls === 4, `3 album attempts + 1 text (got ${s10result.apiCalls})`);
  assert(
    s10.lines.some((line) => line.includes("as text instead")),
    "fallback announced in the log",
  );

  console.log("11) retry budget -> waiting stays bounded");
  calls.length = 0;
  responder = () => httpError(500, "Internal Server Error");
  const s11 = await runScenario(() =>
    sendProductNotification([product({ image: "" })], { retryBudgetMs: 1 }),
  );
  assert(s11.error instanceof TelegramError, "fails when the budget is spent");
  if (s11.error instanceof TelegramError) {
    assert(
      s11.error.message.includes("retry budget"),
      "budget exhaustion explained in the message",
    );
  }
  assert(calls.length === 1, "no further attempts once the budget is gone");

  console.log("12) logs never contain secrets");
  const logBlob = allLogLines.join("\n");
  assert(allLogLines.length > 0, "retry scenarios produced log lines");
  assert(
    !logBlob.includes(config.telegramBotToken),
    "bot token never appears in any log line",
  );
  assert(!logBlob.includes(config.telegramChatId), "chat id never appears in any log line");
  assert(!logBlob.includes("authorization"), "no authorization headers logged");
  assert(logBlob.includes("category=") && logBlob.includes("batch="), "diagnostics present");

  responder = () => jsonResponse(200, { ok: true, result: true });
  console.log(`\n${checks} checks, ${failures} failures`);
  if (failures > 0) {
    console.error("TELEGRAM RETRY CHECK: FAIL");
    process.exit(1);
  }
  console.log("TELEGRAM RETRY CHECK: PASS");
}

main().catch((error: unknown) => {
  console.error("TELEGRAM RETRY CHECK: FAIL");
  console.error(error);
  process.exit(1);
});
