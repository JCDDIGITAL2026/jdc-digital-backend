import { Router } from "express";

// Route reservee a l'environnement de test/demo (Neon + Render, gratuit) :
// permet de (re)peupler les donnees de demonstration sans acces shell,
// que le plan gratuit de l'hebergeur ne fournit pas forcement.
//
// Desactivee par defaut (404) tant que ADMIN_SEED_TOKEN n'est pas defini --
// jamais a activer sur un environnement contenant de vraies donnees, car
// seedDatabase() TRUNCATE toutes les tables avant de les repeupler.
export const adminRouter = Router();

adminRouter.post("/seed", async (req, res) => {
  const expectedToken = process.env.ADMIN_SEED_TOKEN;
  if (!expectedToken) {
    res.status(404).json({ error: "Route indisponible (ADMIN_SEED_TOKEN non defini)." });
    return;
  }
  if (req.header("x-admin-token") !== expectedToken) {
    res.status(403).json({ error: "Jeton invalide." });
    return;
  }

  // Import tardif : evite de charger le module de seed (et sa dependance
  // au pool de base) au demarrage normal du serveur pour une route qui ne
  // sert qu'a un environnement de demo.
  const { seedDatabase } = await import("../../db/seed");
  const { userIds } = await seedDatabase();
  res.json({ ok: true, seededAccounts: Object.keys(userIds) });
});
