import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { alertsRouter } from "./modules/alerts";
import { productsRouter } from "./modules/products";
import { schedulerRouter } from "./modules/scheduler";

function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = (error as { status?: number } | null)?.status;

  if (error instanceof SyntaxError && status === 400) {
    res.status(400).json({ error: "invalid JSON body" });
    return;
  }

  console.error("[api] unexpected error:", error);
  res.status(500).json({ error: "internal server error" });
}

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use("/api/alerts", alertsRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/scheduler", schedulerRouter);

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });

  app.use(errorHandler);

  return app;
}
