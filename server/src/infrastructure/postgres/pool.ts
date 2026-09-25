import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { config } from "../../config";

export type Queryable = Pool | PoolClient;

export function createPool(connectionString: string): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  return new Pool({ connectionString, max: 10 });
}

export const pool = createPool(config.databaseUrl);

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
  db: Queryable = pool,
): Promise<QueryResult<T>> {
  return db.query<T>(text, params as unknown[]);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
