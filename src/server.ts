import "dotenv/config";
import { createApp } from "./app";
import { runMigrations } from "../db/migrate";

const port = Number(process.env.PORT || 3000);

// Sur un hebergement gratuit sans acces shell (Render free tier, par
// exemple), il n'y a pas de moyen simple de lancer `npm run migrate` a la
// main apres deploiement -- cette option (a activer explicitement) le fait
// au demarrage a la place. Sans danger a rejouer : chaque migration ne
// s'applique qu'une fois (voir db/migrate.ts, table schema_migrations).
async function start() {
  if (process.env.RUN_MIGRATIONS_ON_BOOT === "true") {
    console.log("Application des migrations au demarrage (RUN_MIGRATIONS_ON_BOOT=true)...");
    await runMigrations();
  }

  const app = createApp();
  app.listen(port, () => {
    console.log(`JDC Digital backend sur http://localhost:${port}`);
    console.log(`Mode d'authentification : ${process.env.AUTH_MODE || "(non defini)"}`);
  });
}

start().catch((err) => {
  console.error("Echec du demarrage du serveur:", err);
  process.exit(1);
});
