import type { PoolConfig } from "pg";

// Neon (et la plupart des Postgres manages gratuits, dont Render) exigent
// TLS ; un Postgres local (celui de cet environnement de dev) n'a pas de
// certificat a verifier. Plutot que de deviner selon l'hote -- fragile et
// source d'erreurs silencieuses -- la bascule est explicite via
// DATABASE_SSL, a positionner sur l'hebergement de test/production.
export function poolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (process.env.DATABASE_SSL !== "true") {
    return { connectionString };
  }
  return {
    connectionString,
    ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
  };
}
