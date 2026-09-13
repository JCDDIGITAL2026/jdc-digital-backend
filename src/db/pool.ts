import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { poolConfig } from "./sslConfig";

// Un seul pool de connexions partage par toute l'application.
// DATABASE_URL (et DATABASE_SSL) viennent de l'environnement (.env en dev,
// variables d'environnement de l'hebergement en test/production).
export const pool = new Pool(poolConfig());

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
) {
  return pool.query<T>(text, params);
}

// Utilise pour les ecritures qui touchent plusieurs tables (un journal +
// ses equipes/travaux/incidents) -- soit tout est ecrit, soit rien ne l'est.
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
