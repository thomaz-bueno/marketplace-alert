import { chromium, type BrowserContext, type Page } from "playwright";
import { config } from "../../config";

export const MARKETPLACE_URL = "https://www.facebook.com/marketplace/";

export type MarketplaceSessionStatus = {
  url: string;
  title: string;
  loginRequired: boolean;
  cookieCount: number;
};

export type SessionStats = {
  launches: number;
  startedAt: number | null;
  profileDir: string;
  headless: boolean;
  open: boolean;
};

type Session = {
  context: BrowserContext;
  startedAt: number;
  closed: boolean;
};

let session: Session | null = null;
let initializing: Promise<BrowserContext> | null = null;
let launches = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withProfileHint(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const log = (error as { log?: unknown } | null)?.log;
  const details = [message, ...(Array.isArray(log) ? log : [])].join("\n");

  if (/singleton|in use|already running|existing browser session|sessão de navegador existente/i.test(details)) {
    return new Error(
      `browser profile is already in use by another instance (${config.browserUserDataDir}). ` +
        `Stop the other process (server or browser:login) and retry.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

async function launch(headless?: boolean): Promise<BrowserContext> {
  // Playwright registers its own SIGINT handler that force-exits the process
  // (code 130) after killing browsers, which would cut our graceful shutdown.
  // When the host app already listens for SIGINT (the server), drop only the
  // listener Playwright adds during this launch; standalone scripts keep it.
  const sigintBefore = new Set(process.listeners("SIGINT"));

  try {
    const context = await chromium.launchPersistentContext(config.browserUserDataDir, {
      headless: headless ?? config.browserHeadless,
    });

    if (sigintBefore.size > 0) {
      for (const listener of process.listeners("SIGINT")) {
        if (!sigintBefore.has(listener)) process.off("SIGINT", listener);
      }
    }

    launches += 1;
    const current: Session = {
      context,
      startedAt: Date.now(),
      closed: false,
    };
    session = current;

    context.once("close", () => {
      current.closed = true;
      if (session === current) session = null;
      console.log("[browser] persistent context closed");
    });

    console.log(
      `[browser] persistent context launched (launch #${launches}, headless=${headless ?? config.browserHeadless}, profile=${config.browserUserDataDir})`,
    );

    return context;
  } catch (error) {
    throw withProfileHint(error);
  }
}

/**
 * Returns the single reusable persistent context, creating it on first use.
 * Concurrent callers share one launch; later calls reuse the same context,
 * so the browser is never recreated per alert or per scheduler execution.
 */
export async function getBrowserContext(options?: {
  headless?: boolean;
}): Promise<BrowserContext> {
  if (session && !session.closed) return session.context;

  if (!initializing) {
    initializing = launch(options?.headless).finally(() => {
      initializing = null;
    });
  }
  return initializing;
}

export function getSessionStats(): SessionStats {
  return {
    launches,
    startedAt: session && !session.closed ? session.startedAt : null,
    profileDir: config.browserUserDataDir,
    headless: config.browserHeadless,
    open: Boolean(session && !session.closed),
  };
}

/** Detects whether Facebook is asking for authentication on the current page. */
export async function detectLoginRequired(page: Page): Promise<boolean> {
  if (page.url().includes("facebook.com/login")) return true;
  try {
    return (await page.locator('input[name="pass"]:visible').count()) > 0;
  } catch {
    return false;
  }
}

async function waitUntilResolved(page: Page): Promise<boolean> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await detectLoginRequired(page)) return true;
    await page.waitForTimeout(500);
  }
  return detectLoginRequired(page);
}

/** Opens (or reuses) the Marketplace tab and reports the session status. */
export async function openMarketplace(
  context?: BrowserContext,
): Promise<MarketplaceSessionStatus> {
  const active = context ?? (await getBrowserContext());
  const page = active.pages()[0] ?? (await active.newPage());

  await page.goto(MARKETPLACE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  const loginRequired = await waitUntilResolved(page);
  const cookies = await active.cookies();

  return {
    url: page.url(),
    title: await page.title(),
    loginRequired,
    cookieCount: cookies.length,
  };
}

/**
 * Eager startup: creates the persistent context and opens Marketplace once,
 * so the session is available for later executions. Never throws.
 */
export async function initBrowserSession(): Promise<void> {
  try {
    const context = await getBrowserContext();
    const status = await openMarketplace(context);

    if (status.loginRequired) {
      console.log(
        "[browser] Facebook login required — log in manually in the browser window; " +
          "the session is saved in the profile directory.",
      );
    } else {
      console.log("[browser] Facebook session is authenticated.");
    }
    console.log(
      `[browser] session ready (${status.url}, cookies=${status.cookieCount})`,
    );
  } catch (error) {
    console.error("[browser] initialization failed:", errorMessage(error));
  }
}

/** Closes the shared context on process shutdown. Safe to call multiple times. */
export async function closeBrowserSession(): Promise<void> {
  if (initializing) {
    await initializing.catch(() => undefined);
  }

  const current = session;
  session = null;
  if (!current || current.closed) return;

  try {
    // Bounded wait: never let a stuck browser keep the process alive on shutdown.
    const closed = await Promise.race([
      current.context.close().then(() => true, () => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    if (closed) {
      console.log("[browser] session closed gracefully");
    } else {
      console.log("[browser] close did not finish within 3s; exiting anyway");
    }
  } catch (error) {
    console.error("[browser] error while closing session:", errorMessage(error));
  }
}
