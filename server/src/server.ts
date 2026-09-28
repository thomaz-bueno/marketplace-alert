import type { Server } from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { closeBrowserSession, initBrowserSession } from "./infrastructure/browser";
import { startScheduler, stopScheduler } from "./modules/scheduler";

const app = createApp();

const server: Server = app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(
    config.telegramEnabled
      ? "[config] telegram notifications: enabled"
      : `[config] telegram notifications: disabled (${config.telegramDisabledReason})`,
  );
  void initBrowserSession();
  startScheduler();
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[server] ${signal} received, closing scheduler and browser session...`);
  stopScheduler();
  server.close();

  const forceExit = setTimeout(() => process.exit(0), 5000);
  closeBrowserSession()
    .catch((error: unknown) => {
      console.error("[server] error during shutdown:", error);
    })
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
