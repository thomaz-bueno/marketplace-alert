import type { QueryResultRow } from "pg";
import { pool, query, type Queryable } from "../../infrastructure/postgres/pool";
import type { Alert, AlertInput } from "./types";

interface AlertRow extends QueryResultRow {
  id: number;
  product_name: string;
  city: string;
  max_price: string;
  created_at: Date;
  updated_at: Date;
}

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    productName: row.product_name,
    city: row.city,
    maxPrice: Number(row.max_price),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function assertValidId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid alert id: ${id}`);
  }
}

export async function createAlert(
  input: AlertInput,
  db: Queryable = pool,
): Promise<Alert> {
  const result = await query<AlertRow>(
    `INSERT INTO alerts (product_name, city, max_price)
     VALUES ($1, $2, $3)
     RETURNING id, product_name, city, max_price, created_at, updated_at`,
    [input.productName, input.city, input.maxPrice],
    db,
  );
  return toAlert(result.rows[0]);
}

export async function findAllAlerts(db: Queryable = pool): Promise<Alert[]> {
  const result = await query<AlertRow>(
    `SELECT id, product_name, city, max_price, created_at, updated_at
     FROM alerts
     ORDER BY id ASC`,
    [],
    db,
  );
  return result.rows.map(toAlert);
}

export async function findAlertById(
  id: number,
  db: Queryable = pool,
): Promise<Alert | null> {
  assertValidId(id);
  const result = await query<AlertRow>(
    `SELECT id, product_name, city, max_price, created_at, updated_at
     FROM alerts
     WHERE id = $1`,
    [id],
    db,
  );
  const row = result.rows[0];
  return row ? toAlert(row) : null;
}

export async function updateAlert(
  id: number,
  input: AlertInput,
  db: Queryable = pool,
): Promise<Alert | null> {
  assertValidId(id);
  const result = await query<AlertRow>(
    `UPDATE alerts
     SET product_name = $1,
         city = $2,
         max_price = $3,
         updated_at = now()
     WHERE id = $4
     RETURNING id, product_name, city, max_price, created_at, updated_at`,
    [input.productName, input.city, input.maxPrice, id],
    db,
  );
  const row = result.rows[0];
  return row ? toAlert(row) : null;
}

export async function deleteAlert(
  id: number,
  db: Queryable = pool,
): Promise<boolean> {
  assertValidId(id);
  const result = await query("DELETE FROM alerts WHERE id = $1", [id], db);
  return (result.rowCount ?? 0) > 0;
}
