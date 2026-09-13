// Point d'entree CLI : `npm run seed` (contre la base DATABASE_URL du .env).
// La logique elle-meme vit dans seed.ts, reutilisee telle quelle par les
// tests automatiques contre la base jdc_test.
import "dotenv/config";
import { seedDatabase } from "./seed";
import { pool } from "../src/db/pool";

seedDatabase()
  .then(async ({ userIds }) => {
    console.log("Comptes de dev crees (mode AUTH_MODE=dev, POST /auth/dev/login {email}) :");
    for (const email of Object.keys(userIds)) console.log(`  - ${email}`);
    await pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
