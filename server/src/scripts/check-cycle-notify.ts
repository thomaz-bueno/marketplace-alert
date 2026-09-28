import type { Alert } from "../modules/alerts";
import type { Product } from "../modules/products";

type RecordedCall = {
  url: string;
  body: Record<string, unknown> | null;
};

type ScrapeResult = Product[] | Error;

type CycleResultSummary = {
  results: { alertId: number; status: string; error?: string; products: number }[];
};

const FIXTURE_IDS = [
  "cycletest-1001",
  "cycletest-1002",
  "cycletest-1003",
  "cycletest-1004",
  "cycletest-1005",
];

const PARTIAL_IDS = Array.from(
  { length: 12 },
  (_, index) => `cycletest-20${String(index + 1).padStart(2, "0")}`,
);

const ALL_FIXTURE_IDS = [...FIXTURE_IDS, ...PARTIAL_IDS];

let checks = 0;
let failures = 0;
const createdAlertIds: number[] = [];

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

function product(id: string, title: string, price: number): Product {
  return {
    id,
    title,
    price,
    location: "Bauru, SP",
    image: `https://cdn.example.com/${id}.jpg`,
    url: `https://www.facebook.com/marketplace/item/${id}`,
    seller: "Cycle Check",
    description: "",
    createdAt: new Date().toISOString(),
  };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function resultFor(summary: CycleResultSummary, alertId: number) {
  return summary.results.find((result) => result.alertId === alertId);
}

async function main(): Promise<number> {
  // Force deterministic fake Telegram credentials. dotenv does not override
  // variables that are already set, and fetch is mocked below, so no real
  // message can ever leave this script.
  process.env.TELEGRAM_BOT_TOKEN = "123456789:CYCLEcheckfakeTOKEN0000000000";
  process.env.TELEGRAM_CHAT_ID = "555999888";

  const { config } = await import("../config");
  const { createAlert } = await import("../modules/alerts");
  const { connectRedis } = await import("../infrastructure/redis/client");
  const { isCycleRunning, runCycle } = await import("../modules/scheduler/cycle");
  const { validate: validateCron } = await import("node-cron");

  assert(config.telegramEnabled === true, "forced fake credentials enable Telegram");
  assert(validateCron(config.cronSchedule) === true, "cron schedule stays valid");
  assert(
    config.cronSchedule === (process.env.CRON_SCHEDULE?.trim() || "*/15 * * * *"),
    "interval not changed by this stage",
  );

  const calls: RecordedCall[] = [];
  let responder: (call: RecordedCall) => Response = () =>
    jsonResponse(200, { ok: true, result: true });
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const call: RecordedCall = {
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;

  const p1 = product(FIXTURE_IDS[0], "Cycle Bike One", 400);
  const p2 = product(FIXTURE_IDS[1], "Cycle Bike Two", 450);
  const p3 = product(FIXTURE_IDS[2], "Cycle Bike Three", 300);
  const p4 = product(FIXTURE_IDS[3], "Cycle Bike Four", 350);
  const p5 = product(FIXTURE_IDS[4], "Cycle Bike Five", 480);

  const redis = await connectRedis();
  await redis.sRem("notified:products", ALL_FIXTURE_IDS);

  const alertA = await createAlert({
    productName: "Cycle Check A",
    city: "Bauru",
    maxPrice: 500,
  });
  createdAlertIds.push(alertA.id);
  const alertB = await createAlert({
    productName: "Cycle Check B",
    city: "Bauru",
    maxPrice: 500,
  });
  createdAlertIds.push(alertB.id);
  const alertC = await createAlert({
    productName: "Cycle Check C",
    city: "Bauru",
    maxPrice: 500,
  });
  createdAlertIds.push(alertC.id);

  let fixtures = new Map<number, ScrapeResult>();

  async function scrape(alert: Alert): Promise<Product[]> {
    const entry = fixtures.get(alert.id);
    if (entry instanceof Error) throw entry;
    if (entry) return entry;
    return [];
  }

  async function cycle(name: string) {
    calls.length = 0;
    const outcome = await runCycle({ trigger: "manual", scrape });
    if (outcome.status !== "completed") {
      throw new Error(`${name}: cycle did not complete (${JSON.stringify(outcome)})`);
    }
    assert(isCycleRunning() === false, `${name}: lock released`);
    return outcome.summary;
  }

  console.log("cycle 1: two alerts with products, one alert failing -> one notification");
  fixtures = new Map<number, ScrapeResult>([
    [alertA.id, [p1, p2, p3]],
    [alertB.id, [p3, p4]],
    [alertC.id, new Error("simulated scrape failure")],
  ]);
  const first = await cycle("cycle 1");
  assert(first.alerts >= 3, `cycle 1: processes all alerts (got ${first.alerts})`);
  assert(first.products === 5, `cycle 1: 3+2 stored products (got ${first.products})`);
  const a1 = resultFor(first, alertA.id);
  const b1 = resultFor(first, alertB.id);
  const c1 = resultFor(first, alertC.id);
  assert(a1?.status === "saved" && a1.products === 3, "cycle 1: alert A saved 3");
  assert(b1?.status === "saved" && b1.products === 2, "cycle 1: alert B saved 2");
  assert(c1?.status === "failed" && (c1.error ?? "") !== "", "cycle 1: alert C isolated as failed");
  assert(first.notification.status === "sent", "cycle 1: notification sent");
  assert(
    first.notification.products === 4,
    `cycle 1: dedupe across alerts -> 4 new (got ${first.notification.products})`,
  );
  assert(
    calls.length === 1,
    `cycle 1: one logical notification = one API call (got ${calls.length})`,
  );
  assert(calls[0]?.url.endsWith("/sendMediaGroup"), "cycle 1: images use an album");
  const blob1 = calls.map((call) => JSON.stringify(call.body)).join("\n");
  for (const title of [p1.title, p2.title, p3.title, p4.title]) {
    assert(countOccurrences(blob1, title) === 1, `cycle 1: "${title}" appears exactly once`);
  }

  console.log("cycle 2: same products again -> no Telegram call");
  const second = await cycle("cycle 2");
  assert(second.notification.status === "skipped", "cycle 2: nothing new");
  assert(calls.length === 0, `cycle 2: zero Telegram calls (got ${calls.length})`);

  console.log("cycle 3: new product, Telegram returning 500 -> cycle survives");
  responder = () =>
    jsonResponse(500, { ok: false, error_code: 500, description: "Internal Server Error" });
  fixtures = new Map<number, ScrapeResult>([
    [alertA.id, [p5]],
    [alertB.id, []],
    [alertC.id, new Error("simulated scrape failure")],
  ]);
  const third = await cycle("cycle 3");
  const a3 = resultFor(third, alertA.id);
  assert(a3?.status === "saved", "cycle 3: scraping/saving still works during outage");
  assert(third.notification.status === "failed", "cycle 3: reported as failed, not thrown");
  if (third.notification.status === "failed") {
    assert(third.notification.error.includes("500"), "cycle 3: error keeps the status code");
    assert(third.notification.delivered === 0, "cycle 3: nothing confirmed during the outage");
    assert(
      !third.notification.error.includes(config.telegramBotToken),
      "cycle 3: no token in the error",
    );
  }
  assert(
    calls.length >= 3 && calls.length <= 6,
    `cycle 3: attempts bounded to max 3 per message part (got ${calls.length})`,
  );

  console.log("cycle 4: outage over -> the unnotified product is delivered once");
  responder = () => jsonResponse(200, { ok: true, result: true });
  const fourth = await cycle("cycle 4");
  assert(fourth.notification.status === "sent", "cycle 4: scheduler kept running and retried");
  assert(
    fourth.notification.products === 1,
    `cycle 4: exactly one new product (got ${fourth.notification.products})`,
  );
  assert(calls.length === 1, `cycle 4: one logical notification (got ${calls.length})`);
  const blob4 = calls.map((call) => JSON.stringify(call.body)).join("\n");
  assert(blob4.includes(p5.title), "cycle 4: product missed during the outage is in the batch");

  console.log("cycle 5: first album confirmed, rest fails -> partial recorded");
  const partialProducts = PARTIAL_IDS.map((id, index) =>
    product(id, index < 10 ? `Cycle Known ${index + 1}` : `Cycle Late ${index + 1}`, 400),
  );
  responder = (call) => {
    if (call.url.endsWith("/sendMessage")) {
      return jsonResponse(400, {
        ok: false,
        error_code: 400,
        description: "Bad Request: message is too long",
      });
    }
    return calls.length === 1
      ? jsonResponse(200, { ok: true, result: true })
      : jsonResponse(500, { ok: false, error_code: 500, description: "Internal Server Error" });
  };
  fixtures = new Map<number, ScrapeResult>([
    [alertA.id, partialProducts],
    [alertB.id, []],
    [alertC.id, new Error("simulated scrape failure")],
  ]);
  const fifth = await cycle("cycle 5");
  const a5 = resultFor(fifth, alertA.id);
  assert(a5?.status === "saved" && a5.products === 12, "cycle 5: all 12 stored for the UI");
  assert(fifth.notification.status === "failed", "cycle 5: partial reported as failed");
  if (fifth.notification.status === "failed") {
    assert(
      fifth.notification.delivered === 10,
      `cycle 5: first album confirmed before the failure (got ${fifth.notification.delivered})`,
    );
    assert(fifth.notification.products === 12, "cycle 5: the full batch was attempted");
    assert(fifth.notification.error.includes("400"), "cycle 5: last failure kept in the error");
  }
  assert(
    calls.length >= 3 && calls.length <= 7,
    `cycle 5: bounded attempts with fallback (got ${calls.length})`,
  );
  // The store's hash order is not the fixture order, so the confirmed set is
  // read back from the album that actually went out (image urls carry the ids).
  const confirmedIds = new Set<string>();
  const albumMedia = calls[0]?.body?.media;
  if (Array.isArray(albumMedia)) {
    for (const item of albumMedia) {
      const image = String((item as Record<string, unknown>).media ?? "");
      const match = image.match(/\/([^/]+)\.jpg$/);
      if (match) confirmedIds.add(match[1]);
    }
  }
  assert(confirmedIds.size === 10, `cycle 5: album delivered 10 ids (got ${confirmedIds.size})`);

  console.log("cycle 6: confirmed products are not resent, remainder is");
  responder = () => jsonResponse(200, { ok: true, result: true });
  const sixth = await cycle("cycle 6");
  assert(sixth.notification.status === "sent", "cycle 6: remainder delivered");
  assert(
    sixth.notification.products === 2,
    `cycle 6: only the 2 unconfirmed products (got ${sixth.notification.products})`,
  );
  assert(calls.length === 1, `cycle 6: one API call (got ${calls.length})`);
  const blob6 = calls.map((call) => JSON.stringify(call.body)).join("\n");
  const resentIds = PARTIAL_IDS.filter((id) => blob6.includes(id));
  const unconfirmedIds = PARTIAL_IDS.filter((id) => !confirmedIds.has(id));
  assert(resentIds.length === 2, `cycle 6: exactly the 2 unconfirmed ids (got ${resentIds.length})`);
  assert(
    unconfirmedIds.every((id) => resentIds.includes(id)),
    "cycle 6: every unconfirmed product is present",
  );
  assert(
    resentIds.every((id) => !confirmedIds.has(id)),
    "cycle 6: confirmed products are never resent",
  );

  console.log(`\n${checks} checks, ${failures} failures`);
  if (failures > 0) {
    console.error("CYCLE NOTIFY CHECK: FAIL");
    return 1;
  }
  console.log("CYCLE NOTIFY CHECK: PASS");
  return 0;
}

async function cleanup(): Promise<void> {
  const { deleteAlert } = await import("../modules/alerts");
  const { clearAllProducts } = await import("../modules/products");
  const { closeRedis, connectRedis } = await import("../infrastructure/redis/client");
  const { closePool } = await import("../infrastructure/postgres/pool");

  for (const id of createdAlertIds) {
    try {
      await deleteAlert(id);
    } catch {
      /* best effort */
    }
  }
  try {
    const redis = await connectRedis();
    await redis.sRem("notified:products", ALL_FIXTURE_IDS);
    await clearAllProducts();
  } catch {
    /* best effort */
  }
  await closeRedis();
  await closePool();
}

main()
  .then(async (code) => {
    await cleanup();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error("\nCYCLE NOTIFY CHECK: FAIL");
    console.error(error);
    await cleanup();
    process.exit(1);
  });
