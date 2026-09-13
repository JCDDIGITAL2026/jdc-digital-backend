import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/requireAuth";
import { listWorkers, createWorker, updateWorker, recordAuditEvent } from "../db/repositories";
import { createWorkerSchema, updateWorkerSchema } from "../validation/worker";

export const workersRouter = Router();

workersRouter.use(requireAuth);

// Lecture ouverte a tout utilisateur authentifie : un chef de chantier a
// besoin du registre complet pour composer son pointage du jour. Le
// registre ne contient aucune donnee de chantier -- juste identite et
// qualification, rien a cloisonner ici.
workersRouter.get("/", async (req, res) => {
  const { active } = req.query;
  const workers = await listWorkers({
    active: active === "true" ? true : active === "false" ? false : undefined,
  });
  res.json({ workers });
});

// Le registre lui-meme (creation/edition/desactivation) reste reserve a
// direction/admin -- un chef de chantier consomme le registre, il ne le
// gere pas (coherent avec la decision "identification interne simple"
// prise sur Pilotis : pas de gestion de compte deleguee).
const canManage = requireRole("ADMIN", "DIRECTION");

workersRouter.post("/", canManage, async (req, res) => {
  const parsed = createWorkerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.flatten() });
    return;
  }
  try {
    const worker = await createWorker(parsed.data);
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "WORKER_CREATE",
      entityType: "worker",
      entityId: worker.id,
    });
    res.status(201).json({ worker });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Ce matricule est deja utilise." });
      return;
    }
    throw err;
  }
});

workersRouter.patch("/:id", canManage, async (req, res) => {
  const parsed = updateWorkerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.flatten() });
    return;
  }
  try {
    const worker = await updateWorker(req.params.id, parsed.data);
    if (!worker) {
      res.status(404).json({ error: "Ouvrier introuvable." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "WORKER_UPDATE",
      entityType: "worker",
      entityId: worker.id,
    });
    res.json({ worker });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Ce matricule est deja utilise." });
      return;
    }
    throw err;
  }
});
