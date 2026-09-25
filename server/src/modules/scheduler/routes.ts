import { Router, type NextFunction, type Request, type Response } from "express";
import { runCycle } from "./cycle";

type Handler = (req: Request, res: Response) => Promise<void>;

function wrap(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

export const schedulerRouter = Router();

/**
 * Manual cycle trigger for development. It runs the same runCycle() as the
 * cron (it does not replace it) and reports 409 while a cycle is running.
 */
schedulerRouter.post(
  "/run",
  wrap(async (_req, res) => {
    const outcome = await runCycle({ trigger: "manual" });
    if (outcome.status === "skipped") {
      res.status(409).json({ error: "cycle already running" });
      return;
    }
    res.status(200).json({ data: outcome.summary });
  }),
);
