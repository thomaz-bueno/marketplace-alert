import { Router, type NextFunction, type Request, type Response } from "express";
import * as service from "./service";

type Handler = (req: Request, res: Response) => Promise<void>;

function wrap(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

export const productsRouter = Router();

productsRouter.get(
  "/",
  wrap(async (_req, res) => {
    res.status(200).json({ data: await service.listProducts() });
  }),
);
