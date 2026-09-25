import {
  createAlert as insertAlert,
  deleteAlert,
  findAllAlerts,
  findAlertById,
  updateAlert as replaceAlert,
} from "./repository";
import type { Alert } from "./types";
import { validateAlertId, validateAlertInput } from "./validation";

export type ServiceFailure =
  | { status: 400; errors: string[] }
  | { status: 404 };

export type ServiceResult<T> =
  | { ok: true; value: T }
  | ({ ok: false } & ServiceFailure);

export async function listAlerts(): Promise<Alert[]> {
  return findAllAlerts();
}

export async function getAlert(idParam: unknown): Promise<ServiceResult<Alert>> {
  const id = validateAlertId(idParam);
  if (!id.ok) return { ok: false, status: 400, errors: id.errors };

  const alert = await findAlertById(id.value);
  if (!alert) return { ok: false, status: 404 };
  return { ok: true, value: alert };
}

export async function createAlert(body: unknown): Promise<ServiceResult<Alert>> {
  const input = validateAlertInput(body);
  if (!input.ok) return { ok: false, status: 400, errors: input.errors };

  const alert = await insertAlert(input.value);
  return { ok: true, value: alert };
}

export async function updateAlert(
  idParam: unknown,
  body: unknown,
): Promise<ServiceResult<Alert>> {
  const id = validateAlertId(idParam);
  if (!id.ok) return { ok: false, status: 400, errors: id.errors };

  const input = validateAlertInput(body);
  if (!input.ok) return { ok: false, status: 400, errors: input.errors };

  const alert = await replaceAlert(id.value, input.value);
  if (!alert) return { ok: false, status: 404 };
  return { ok: true, value: alert };
}

export async function removeAlert(
  idParam: unknown,
): Promise<ServiceResult<{ id: number; deleted: true }>> {
  const id = validateAlertId(idParam);
  if (!id.ok) return { ok: false, status: 400, errors: id.errors };

  const deleted = await deleteAlert(id.value);
  if (!deleted) return { ok: false, status: 404 };
  return { ok: true, value: { id: id.value, deleted: true } };
}
