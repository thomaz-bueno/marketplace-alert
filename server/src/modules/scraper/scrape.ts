import type { Page } from "playwright";
import { detectLoginRequired, getScrapePage } from "../../infrastructure/browser";
import type { Alert } from "../alerts";
import { dedupeProducts, type Product } from "../products";
import { ScrapeError } from "./errors";
import { matchesCity } from "./location";
import { extractPrice } from "./price";
import {
  parseCard,
  parseDetailScript,
  type ListingCandidate,
  type ListingDetail,
  type RawCard,
} from "./parse";

const SEARCH_BASE = "https://www.facebook.com/marketplace/search/?query=";
const EMPTY_RESULTS_TEXT = /Nenhum classificado encontrado|No listings found/i;
const DETAILS_SCRIPT_MARKER = "marketplace_product_details_page";
const CARD_SELECTOR = 'a[href*="/marketplace/item/"]';

function searchUrl(productName: string): string {
  return `${SEARCH_BASE}${encodeURIComponent(productName)}`;
}

/**
 * Navigates to the search results page and waits until one of the three
 * observable states is present: result cards, the empty-results message or
 * a login URL. The login dialog overlay itself is NOT a valid signal — it is
 * visible even on healthy result pages for logged-out sessions.
 */
async function openSearch(page: Page, alert: Alert): Promise<RawCard[]> {
  await page.goto(searchUrl(alert.productName), {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  try {
    await page.waitForFunction(
      () => {
        if (document.querySelector('a[href*="/marketplace/item/"]')) return true;
        const text = document.body?.innerText ?? "";
        if (/Nenhum classificado encontrado|No listings found/.test(text)) return true;
        return window.location.href.includes("facebook.com/login");
      },
      undefined,
      { timeout: 15_000 },
    );
  } catch {
    // Triage below reports the precise reason.
  }

  const cards = await collectCards(page);
  if (cards.length > 0) return cards;

  // 0 cards: prefer the explicit empty message over the login heuristic,
  // because the login dialog overlay can also sit on an empty results page.
  const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
  if (EMPTY_RESULTS_TEXT.test(bodyText)) return [];

  if (await detectLoginRequired(page)) {
    throw new ScrapeError(
      `Facebook login required while scraping alert ${alert.id} (${page.url()})`,
      alert.id,
    );
  }

  throw new ScrapeError(
    `unexpected Marketplace page while scraping alert ${alert.id} (${page.url()})`,
    alert.id,
  );
}

/** Collects raw card data from the rendered search results. */
async function collectCards(page: Page): Promise<RawCard[]> {
  return page.$$eval(CARD_SELECTOR, (anchors) =>
    anchors.map((anchor) => ({
      href: anchor.getAttribute("href") ?? "",
      spans: Array.from(anchor.querySelectorAll('span[dir="auto"]')).map(
        (span) => span.textContent ?? "",
      ),
      image: anchor.querySelector("img")?.src ?? "",
    })),
  );
}

/**
 * Loads the canonical detail page and reads the server-rendered JSON payload.
 * The visible detail DOM does not render for logged-out sessions, so we wait
 * for the embedded payload script instead. Returns null on any failure.
 */
async function loadDetail(
  page: Page,
  candidate: ListingCandidate,
): Promise<ListingDetail | null> {
  try {
    await page.goto(candidate.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForFunction(
      (marker) =>
        Array.from(document.querySelectorAll('script[type="application/json"]')).some(
          (script) => (script.textContent ?? "").includes(marker),
        ),
      DETAILS_SCRIPT_MARKER,
      { timeout: 15_000 },
    );
  } catch {
    return null;
  }

  // Several embedded scripts can mention the marker (e.g. a small
  // ScheduledServerJS stub before the real payload), so collect all of them
  // and use the first one that actually parses into listing details.
  const scripts = await page.evaluate(
    (marker) =>
      Array.from(document.querySelectorAll('script[type="application/json"]'))
        .map((script) => script.textContent ?? "")
        .filter((text) => text.includes(marker)),
    DETAILS_SCRIPT_MARKER,
  );

  for (const scriptText of scripts) {
    const detail = parseDetailScript(scriptText);
    if (detail) return detail;
  }
  return null;
}

/**
 * Scrapes one alert end to end and returns the matching products.
 *
 * Flow: search page -> card parsing -> city/price prefilter -> detail payload
 * per survivor -> final price/city check -> dedupe. Failures that make the
 * scrape untrustworthy (login wall, unusable page, all detail loads failed)
 * throw ScrapeError so the scheduler can isolate them per alert; legitimate
 * empty results simply return [].
 *
 * All alerts share the session's single tab; the scheduler runs alerts
 * sequentially, so navigations never overlap on this page.
 */
export async function scrapeAlert(alert: Alert): Promise<Product[]> {
  const page = await getScrapePage();

  const rawCards = await openSearch(page, alert);

  const candidates: ListingCandidate[] = [];
  let prefiltered = 0;
  for (const raw of rawCards) {
    const candidate = parseCard(raw);
    if (!candidate) continue;
    if (candidate.location !== "" && !matchesCity(candidate.location, alert.city)) {
      prefiltered += 1;
      continue;
    }
    const quickPrice = extractPrice(candidate.priceText, candidate.title, null);
    if (quickPrice !== null && quickPrice > alert.maxPrice) {
      prefiltered += 1;
      continue;
    }
    candidates.push(candidate);
  }

  const products: Product[] = [];
  let detailFailures = 0;
  for (const candidate of candidates) {
    const detail = await loadDetail(page, candidate);
    if (!detail) {
      detailFailures += 1;
      continue;
    }

    const price =
      extractPrice(
        candidate.priceText || detail.priceText,
        candidate.title,
        detail.description,
      ) ?? detail.priceAmount;
    if (price === null || price > alert.maxPrice) continue;

    const location = candidate.location || detail.location;
    if (!matchesCity(location, alert.city)) continue;

    products.push({
      id: candidate.id,
      title: detail.title || candidate.title,
      price,
      location,
      image: candidate.image,
      url: candidate.url,
      seller: detail.seller,
      description: detail.description,
      createdAt: detail.createdAt,
    });
  }

  if (candidates.length > 0 && detailFailures === candidates.length) {
    throw new ScrapeError(
      `all ${detailFailures} detail page(s) failed while scraping alert ${alert.id}`,
      alert.id,
    );
  }

  const unique = dedupeProducts(products);
  console.log(
    `[scraper] alert ${alert.id}: ${rawCards.length} card(s) -> ` +
      `${candidates.length} candidate(s) -> ${unique.length} product(s) ` +
      `(prefiltered ${prefiltered}, detail failures ${detailFailures})`,
  );
  return unique;
}
