import {
  closeBrowserSession,
  getBrowserContext,
  getSessionStats,
  openMarketplace,
} from "../infrastructure/browser";

async function main(): Promise<void> {
  const first = await getBrowserContext();
  const firstStatus = await openMarketplace(first);

  const second = await getBrowserContext();
  const secondStatus = await openMarketplace(second);

  const stats = getSessionStats();
  const reused = first === second && stats.launches === 1;
  const cookieNames = (await first.cookies()).map((cookie) => cookie.name);

  console.log("[check] session status:");
  console.log(
    JSON.stringify(
      {
        reusedSameContext: reused,
        launches: stats.launches,
        profileDir: stats.profileDir,
        url: firstStatus.url,
        title: firstStatus.title,
        loginRequired: firstStatus.loginRequired,
        cookies: firstStatus.cookieCount,
        cookieNames,
        secondNavigationOk: secondStatus.url === firstStatus.url,
      },
      null,
      2,
    ),
  );

  if (!reused) {
    throw new Error("context was not reused across calls");
  }
  if (firstStatus.loginRequired) {
    console.log(
      "[check] authentication required — run `npm run browser:login` and log in manually.",
    );
  } else {
    console.log("[check] session is authenticated.");
  }

  await closeBrowserSession();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[check] failed:", error);
    process.exit(1);
  });
