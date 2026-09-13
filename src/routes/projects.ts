import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { listAccessibleProjects, userCanAccessProject } from "../db/repositories";
import { query } from "../db/pool";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

// Toujours filtre server-side par listAccessibleProjects -- un chef de
// chantier ne recoit jamais, meme dans la reponse JSON brute, un chantier
// auquel il n'est pas affecte.
projectsRouter.get("/", async (req, res) => {
  const projects = await listAccessibleProjects(req.user!);
  res.json({ projects });
});

projectsRouter.get("/:id", async (req, res) => {
  const allowed = await userCanAccessProject(req.user!, req.params.id);
  if (!allowed) {
    res.status(403).json({ error: "Acces refuse a ce chantier." });
    return;
  }
  const { rows } = await query("select * from projects where id = $1", [
    req.params.id,
  ]);
  if (!rows[0]) {
    res.status(404).json({ error: "Chantier introuvable." });
    return;
  }
  res.json({ project: rows[0] });
});
