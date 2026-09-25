import { closeBrowserSession } from "../infrastructure/browser";
import { serializeProduct, deserializeProduct, type Product } from "../modules/products";
import {
  ScrapeError,
  extractPrice,
  matchesCity,
  normalizeCity,
  parseCard,
  parseDetailScript,
  parsePrice,
  scrapeAlert,
} from "../modules/scraper";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function checkPriceParsing(): void {
  assertEqual(parsePrice("US$100"), 100, "US$ price");
  assertEqual(parsePrice("R$ 1.800,00"), 1800, "pt-BR thousands and cents");
  assertEqual(parsePrice("US$ 12.345,67"), 12345.67, "pt-BR thousands with cents");
  assertEqual(parsePrice("1,800"), 1800, "comma as thousands separator");
  assertEqual(parsePrice("1,800.00"), 1800, "en-US grouping");
  assertEqual(parsePrice("90,50"), 90.5, "comma as decimal mark");
  assertEqual(parsePrice("1.800"), 1800, "dot as thousands separator");
  assertEqual(parsePrice("US$2.000"), 2000, "observed live price format");
  assertEqual(parsePrice("$50"), 50, "bare dollar sign");
  assertEqual(parsePrice(""), null, "empty string");
  assertEqual(parsePrice("Acabou de ser anunciado"), null, "badge without digits");
  assertEqual(parsePrice(null), null, "null");

  assertEqual(
    extractPrice("US$100", "Bicicleta 50", "Only 30 dollars"),
    100,
    "price field wins",
  );
  assertEqual(extractPrice(null, "Bicicleta $50", "desc"), 50, "title fallback");
  assertEqual(extractPrice(null, "Bicicleta", "Custo 70 dol"), 70, "description fallback");
  console.log("price:    parsePrice/extractPrice cases OK");
}

function checkCityNormalization(): void {
  for (const variant of ["Bauru", "Bauru - SP", "Bauru, São Paulo", "Bauru/SP", "BAURU - SP"]) {
    assert(matchesCity(variant, "Bauru"), `variant "${variant}" matches Bauru`);
    assertEqual(normalizeCity(variant), "bauru", `normalize "${variant}"`);
  }
  assert(matchesCity("Oakland, CA", "Oakland"), "US city with state suffix");
  assert(!matchesCity("Emeryville, CA", "Oakland"), "different cities do not match");
  assert(!matchesCity("", "Bauru"), "empty location does not match");
  assert(!matchesCity("Bauru", ""), "empty alert city does not match");
  console.log("city:     normalizeCity/matchesCity cases OK");
}

function checkCardParsing(): void {
  const image = "https://scontent.example.com/v/t39/photo.jpg";

  const regular = parseCard({
    href: "/marketplace/item/2283715979030602/?ref=search&referral_code",
    spans: ["US$100", "Bicicleta", "Oakland, CA"],
    image,
  });
  assert(regular !== null, "regular card parses");
  assertEqual(regular?.id, "2283715979030602", "id extracted from href");
  assertEqual(
    regular?.url,
    "https://www.facebook.com/marketplace/item/2283715979030602/",
    "canonical url",
  );
  assertEqual(regular?.title, "Bicicleta", "title");
  assertEqual(regular?.priceText, "US$100", "price text");
  assertEqual(regular?.location, "Oakland, CA", "location");

  const badge = parseCard({
    href: "/marketplace/item/1445169597757362/?ref=search",
    spans: ["Acabou de ser anunciado", "US$100", "Bicycle-Bicicleta para adulto", "Richmond, CA"],
    image,
  });
  assertEqual(badge?.priceText, "US$100", "badge span ignored, price still found");
  assertEqual(badge?.title, "Bicycle-Bicicleta para adulto", "title after badge");
  assertEqual(badge?.location, "Richmond, CA", "location after badge");

  const reduced = parseCard({
    href: "/marketplace/item/1406361651642567/?ref=search",
    spans: ["US$190", "US$250", "Bicicleta de Montaña Ozark Trail", "Richmond, CA"],
    image,
  });
  assertEqual(reduced?.priceText, "US$190", "current price is the first parseable span");
  assertEqual(reduced?.location, "Richmond, CA", "location is the last span");

  assert(parseCard({ href: "/marketplace/item/123/?ref=x", spans: ["US$10"], image }) === null, "too few spans rejected");
  assert(parseCard({ href: "/search/?query=x", spans: ["US$100", "T", "C"], image }) === null, "non-item href rejected");
  console.log("card:     parseCard real-page samples OK");
}

function checkDetailPayload(): void {
  const target = {
    marketplace_listing_title: "Bicicleta aro 26",
    listing_price: {
      formatted_amount_zeros_stripped: "US$100",
      amount: "100.00",
      currency: "USD",
    },
    location_text: { text: "Emeryville, CA" },
    redacted_description: { text: "Good condition, second owner" },
    creation_time: 1726950000,
    marketplace_listing_seller: null,
  };

  // Shape observed on the real logged-out detail page:
  // require[0][3][0].__bbox.require[3][3][1].__bbox.result.data.viewer
  //   .marketplace_product_details_page.target
  const payload = {
    require: [
      [
        0,
        null,
        {
          __bbox: {
            require: [
              [
                3,
                null,
                [
                  null,
                  [
                    3,
                    null,
                    [
                      1,
                      {
                        __bbox: {
                          result: {
                            data: {
                              viewer: { marketplace_product_details_page: { target } },
                            },
                          },
                        },
                      },
                    ],
                  ],
                ],
              ],
            ],
          },
        },
      ],
    ],
  };

  const detail = parseDetailScript(JSON.stringify(payload));
  assert(detail !== null, "observed payload shape parses");
  assertEqual(detail?.title, "Bicicleta aro 26", "detail title");
  assertEqual(detail?.priceText, "US$100", "detail price text");
  assertEqual(detail?.priceAmount, 100, "detail numeric amount");
  assertEqual(detail?.location, "Emeryville, CA", "detail location");
  assertEqual(detail?.description, "Good condition, second owner", "detail description");
  assertEqual(detail?.createdAt, new Date(1726950000 * 1000).toISOString(), "creation_time -> ISO");
  assertEqual(detail?.seller, "", "logged-out seller is an empty string");

  const renderableOnly = parseDetailScript(
    JSON.stringify({
      marketplace_product_details_page: {
        marketplace_listing_renderable_target: {
          marketplace_listing_title: "Só renderable",
          listing_price: { amount: "45.50" },
        },
      },
    }),
  );
  assertEqual(renderableOnly?.title, "Só renderable", "renderable target fallback");
  assertEqual(renderableOnly?.priceAmount, 45.5, "renderable target amount");

  assert(parseDetailScript("not json") === null, "invalid JSON rejected");
  assert(parseDetailScript(JSON.stringify({ foo: 1 })) === null, "missing payload rejected");

  const error = new ScrapeError("boom", 7);
  assertEqual(error.name, "ScrapeError", "ScrapeError name");
  assertEqual(error.alertId, 7, "ScrapeError alertId");
  console.log("detail:   parseDetailScript observed payload OK");
}

async function checkLiveScraping(): Promise<void> {
  // Live smoke test against the real page with the current browser profile
  // (profile location: San Francisco area -> results in US$, cities like
  // Oakland/San Francisco). Listings change; these queries are stable enough
  // for a smoke test and the empty state is deterministic.
  const oakland = {
    id: 901,
    productName: "bicicleta",
    city: "Oakland",
    maxPrice: 100,
    createdAt: "",
    updatedAt: "",
  };
  const products = await scrapeAlert(oakland);
  assert(products.length >= 1, `Oakland search returns at least 1 product (got ${products.length})`);

  for (const product of products) {
    assert(product.price <= oakland.maxPrice, `price ${product.price} respects maxPrice`);
    assert(matchesCity(product.location, oakland.city), `location "${product.location}" matches alert city`);
    assert(product.id.trim() !== "", "product id present");
    assert(product.url.includes("/marketplace/item/"), "product url is canonical item url");
    assert(!Number.isNaN(Date.parse(product.createdAt)), `createdAt "${product.createdAt}" is ISO parseable`);

    const roundTrip = deserializeProduct(serializeProduct(product));
    assert(roundTrip !== null, "product survives serialize/deserialize");
    assertEqual(roundTrip?.id, product.id, "round-trip id");
    assertEqual(roundTrip?.price, product.price, "round-trip price");
  }
  console.log(
    `live:     Oakland<=100 -> ${products.length} product(s): ` +
      products.map((product: Product) => `${product.id} US$${product.price}`).join(", "),
  );

  const bauru = await scrapeAlert({
    id: 902,
    productName: "bicicleta",
    city: "Bauru",
    maxPrice: 100,
    createdAt: "",
    updatedAt: "",
  });
  assertEqual(bauru.length, 0, "SF-area results never match city Bauru");
  console.log("live:     Bauru city filter -> 0 products");

  const empty = await scrapeAlert({
    id: 903,
    productName: "zzqqxxvvww987654",
    city: "Bauru",
    maxPrice: 500,
    createdAt: "",
    updatedAt: "",
  });
  assertEqual(empty.length, 0, "empty results state returns [] (not an error)");
  console.log("live:     empty results -> 0 products, no ScrapeError");
}

async function main(): Promise<void> {
  checkPriceParsing();
  checkCityNormalization();
  checkCardParsing();
  checkDetailPayload();
  await checkLiveScraping();

  console.log("\nSCRAPER CHECK: PASS");
}

main()
  .then(async () => {
    await closeBrowserSession();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("\nSCRAPER CHECK: FAIL");
    console.error(error);
    await closeBrowserSession();
    process.exit(1);
  });
