/** Alert-level scraping failure that the scheduler can isolate per alert. */
export class ScrapeError extends Error {
  readonly alertId: number;

  constructor(
    message: string,
    alertId: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ScrapeError";
    this.alertId = alertId;
  }
}
