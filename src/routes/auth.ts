import { Router } from "express";
import { z } from "zod";
import { findUserByEmail } from "../db/repositories";
import { issueSession, clearSession } from "../auth/session";
import { requireAuth } from "../middleware/requireAuth";
import { recordAuditEvent } from "../db/repositories";
import { buildEntraAuthUrl, handleEntraCallback } from "../auth/entra";

export const authRouter = Router();

const devLoginSchema = z.object({ email: z.string().email() });

// Mode dev UNIQUEMENT : simule ce qu'Entra ID ferait (etablir une identite),
// mais tire encore le role et les droits depuis la base, jamais du corps de
// la requete -- c'est le seul raccourci pris ici, et il est desactive des
// que AUTH_MODE != "dev".
authRouter.post("/dev/login", async (req, res) => {
  if (process.env.AUTH_MODE !== "dev") {
    res.status(404).json({ error: "Route indisponible hors mode dev." });
    return;
  }
  const parsed = devLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email invalide." });
    return;
  }
  const user = await findUserByEmail(parsed.data.email);
  if (!user) {
    res.status(401).json({ error: "Aucun compte actif pour cet email." });
    return;
  }
  issueSession(res, user.id);
  await recordAuditEvent({
    actorId: user.id,
    action: "LOGIN_DEV",
    entityType: "user",
    entityId: user.id,
  });
  res.json({ user });
});

// Point d'entree reel, pour quand ENTRA_TENANT_ID / ENTRA_CLIENT_ID /
// ENTRA_CLIENT_SECRET seront renseignes (voir src/auth/entra.ts).
authRouter.get("/entra/login", async (req, res) => {
  try {
    const url = await buildEntraAuthUrl();
    res.redirect(url);
  } catch (err: any) {
    res.status(503).json({
      error:
        "Entra ID n'est pas encore configure sur cet environnement.",
      detail: err.message,
    });
  }
});

authRouter.get("/entra/callback", async (req, res) => {
  try {
    const user = await handleEntraCallback(req);
    issueSession(res, user.id);
    await recordAuditEvent({
      actorId: user.id,
      action: "LOGIN_ENTRA",
      entityType: "user",
      entityId: user.id,
    });
    res.redirect("/");
  } catch (err: any) {
    res.status(401).json({ error: "Echec de l'authentification Entra ID.", detail: err.message });
  }
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  await recordAuditEvent({
    actorId: req.user!.id,
    action: "LOGOUT",
    entityType: "user",
    entityId: req.user!.id,
  });
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
