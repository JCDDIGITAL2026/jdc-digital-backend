// Point d'entree CLI : `npm run migrate` (contre la base DATABASE_URL du
// .env). La logique vit dans migrate.ts, reutilisee telle quelle par
// server.ts au demarrage quand RUN_MIGRATIONS_ON_BOOT=true.
import "dotenv/config";
import { runMigrations } from "./migrate";

runMigrations().catch((err) => {
  console.error("Echec des migrations:", err);
  process.exit(1);
});
