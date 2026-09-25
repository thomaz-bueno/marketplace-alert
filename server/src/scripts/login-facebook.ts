import {
  MARKETPLACE_URL,
  closeBrowserSession,
  detectLoginRequired,
  getBrowserContext,
  getSessionStats,
  openMarketplace,
} from "../infrastructure/browser";

const WAIT_LIMIT_MS = 10 * 60 * 1000;
const POLL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // Ctrl+C must close the visible window before exiting (registered before the
  // browser launches, which also disables Playwright's own force-exit handler).
  process.on("SIGINT", () => {
    void closeBrowserSession().finally(() => process.exit(0));
  });

  // Manual login needs a visible window, regardless of BROWSER_HEADLESS.
  const context = await getBrowserContext({ headless: false });
  const status = await openMarketplace(context);

  if (!status.loginRequired) {
    console.log("[login] session is already authenticated; nothing to do.");
    await closeBrowserSession();
    return;
  }

  const page = context.pages()[0];
  if (!page) throw new Error("no page available");

  console.log(`[login] authentication required. Open: ${MARKETPLACE_URL}`);
  console.log(
    "[login] log in manually in the browser window — credentials are never " +
      "read or stored by this application.",
  );
  console.log(
    `[login] waiting up to ${WAIT_LIMIT_MS / 60000} minutes; the session is saved in ${getSessionStats().profileDir}.`,
  );

  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (!(await detectLoginRequired(page))) {
      console.log(
        "[login] login detected — session persisted in the profile directory.",
      );
      await closeBrowserSession();
      return;
    }
  }

  console.error("[login] timed out waiting for manual login.");
  await closeBrowserSession();
  process.exitCode = 1;
}

main().catch(async (error: unknown) => {
  console.error("[login] failed:", error);
  await closeBrowserSession();
  process.exitCode = 1;
});
