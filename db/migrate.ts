// Runner de migrations minimal : execute les fichiers db/migrations/*.sql
// dans l'ordre alphabetique, une seule fois chacun (suivi dans la table
// schema_migrations). Pas de dependance a un outil externe.
//
// Exporte runMigrations() pour etre appelable depuis le serveur au demarrage
// (voir src/server.ts, RUN_MIGRATIONS_ON_BOOT) -- utile sur un hebergement
// gratuit sans acces shell (Render free tier) ou l'on ne peut pas lancer
// `npm run migrate` a la main apres deploiement.
//
// Module purement exports -- pas d'auto-execution ici. tsx charge ce
// fichier en mode ESM (`require` y est indefini), donc le point d'entree
// CLI est un fichier separe (migrate-cli.ts), comme pour db/seed.ts et
// seed-cli.ts.
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { Pool } from "pg";
import { poolConfig } from "../src/db/sslConfig";

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL manquant (voir .env)");
  }

  const pool = new Pool(poolConfig());
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const dir = path.join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const { rows } = await client.query(
        "select 1 from schema_migrations where filename = $1",
        [file]
      );
      if (rows.length > 0) {
        console.log(`- ${file} (deja appliquee)`);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), "utf8");
      console.log(`> application de ${file}...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (filename) values ($1)",
          [file]
        );
        await client.query("commit");
        console.log(`  ok`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
