import { Router, type NextFunction, type Request, type Response } from "express";
import * as service from "./service";
import type { ServiceFailure } from "./service";

type Handler = (req: Request, res: Response) => Promise<void>;

function wrap(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

function sendData(res: Response, status: number, body: unknown): void {
  res.status(status).json({ data: body });
}

function sendFailure(res: Response, failure: ServiceFailure): void {
  if (failure.status === 404) {
    res.status(404).json({ error: "alert not found" });
    return;
  }
  res.status(400).json({ error: "validation failed", details: failure.errors });
}

export const alertsRouter = Router();

alertsRouter.get(
  "/",
  wrap(async (_req, res) => {
    sendData(res, 200, await service.listAlerts());
  }),
);

alertsRouter.post(
  "/",
  wrap(async (req, res) => {
    const result = await service.createAlert(req.body);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    sendData(res, 201, result.value);
  }),
);

alertsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const result = await service.getAlert(req.params.id);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    sendData(res, 200, result.value);
  }),
);

alertsRouter.put(
  "/:id",
  wrap(async (req, res) => {
    const result = await service.updateAlert(req.params.id, req.body);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    sendData(res, 200, result.value);
  }),
);

alertsRouter.delete(
  "/:id",
  wrap(async (req, res) => {
    const result = await service.removeAlert(req.params.id);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    sendData(res, 200, result.value);
  }),
);
