import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/requireAuth";
import {
  listDailyLogsForUser,
  getDailyLogDetail,
  createDailyLogDraft,
  findDailyLogForMutation,
  updateDailyLogDraft,
  submitDailyLog,
  reviewDailyLog,
  userCanAccessProject,
  recordAuditEvent,
  addAttachment,
  findAttachmentById,
  deleteAttachment,
  ConflictError,
} from "../db/repositories";
import {
  createDailyLogSchema,
  updateDailyLogSchema,
  reviewDailyLogSchema,
} from "../validation/dailyLog";
import { saveFile, deleteStoredFile } from "../storage/fileStorage";

// Photos de chantier et PDF uniquement -- coherent avec l'usage (illustrer
// un journal, joindre un rapport signe scanne), pas un stockage de fichiers
// generique. 10 Mo/fichier : suffisant pour une photo de telephone, sans
// laisser un chef de chantier saturer le stockage local de cet increment.
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("UNSUPPORTED_MIME_TYPE"));
      return;
    }
    cb(null, true);
  },
});

export const dailyLogsRouter = Router();

dailyLogsRouter.use(requireAuth);

// Un lecteur reste strictement en lecture -- aucune des routes d'ecriture
// ci-dessous ne lui est accessible, quel que soit le chantier.
const canWrite = requireRole("ADMIN", "DIRECTION", "CHEF_CHANTIER");

// Valider ou renvoyer un journal est reserve a direction/admin -- un chef
// de chantier ne peut pas valider son propre rapport, c'est le sens meme
// du workflow de validation.
const canReview = requireRole("ADMIN", "DIRECTION");

dailyLogsRouter.get("/", async (req, res) => {
  const { projectId, from, to } = req.query;
  const logs = await listDailyLogsForUser(req.user!, {
    projectId: typeof projectId === "string" ? projectId : undefined,
    from: typeof from === "string" ? from : undefined,
    to: typeof to === "string" ? to : undefined,
  });
  res.json({ dailyLogs: logs });
});

dailyLogsRouter.get("/:id", async (req, res) => {
  const detail = await getDailyLogDetail(req.user!, req.params.id);
  if (detail === null) {
    res.status(404).json({ error: "Journal introuvable." });
    return;
  }
  if (detail === "forbidden") {
    res.status(403).json({ error: "Acces refuse a ce journal." });
    return;
  }
  res.json({ dailyLog: detail });
});

// Cree un brouillon pour un chantier et une date. Un chef de chantier ne
// peut le faire que sur un chantier ou il est affecte -- verifie contre la
// base, jamais contre ce que le client pretend. La contrainte "un seul
// journal par chantier et par date" est imposee par la base (409 sinon).
dailyLogsRouter.post("/", canWrite, async (req, res) => {
  const parsed = createDailyLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.flatten() });
    return;
  }

  const allowed = await userCanAccessProject(req.user!, parsed.data.projectId);
  if (!allowed) {
    res.status(403).json({ error: "Acces refuse a ce chantier." });
    return;
  }

  try {
    const dailyLogId = await createDailyLogDraft(req.user!, parsed.data);
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "DAILY_LOG_CREATE",
      entityType: "daily_log",
      entityId: dailyLogId,
      metadata: { projectId: parsed.data.projectId, date: parsed.data.date },
    });
    const detail = await getDailyLogDetail(req.user!, dailyLogId);
    res.status(201).json({ dailyLog: detail });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// Modifie un brouillon existant (remplace en bloc equipes/travaux/incidents).
// Refuse (409) des qu'un journal a quitte le statut DRAFT -- une fois soumis,
// il n'est plus modifiable a cet increment (la validation/le renvoi arrivent
// dans un increment suivant).
dailyLogsRouter.patch("/:id", canWrite, async (req, res) => {
  const log = await findDailyLogForMutation(req.user!, req.params.id);
  if (log === null) {
    res.status(404).json({ error: "Journal introuvable." });
    return;
  }
  if (log === "forbidden") {
    res.status(403).json({ error: "Acces refuse a ce journal." });
    return;
  }
  if (log.status !== "DRAFT") {
    res.status(409).json({ error: "Ce journal n'est plus modifiable (deja soumis ou valide)." });
    return;
  }

  const parsed = updateDailyLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.flatten() });
    return;
  }

  // log.date vient de pg sous forme de Date -- normalise en AAAA-MM-JJ pour
  // la comparaison avec le pointage d'autres journaux et pour le message
  // d'erreur eventuel.
  const dateStr =
    typeof log.date === "string" ? log.date : log.date.toISOString().slice(0, 10);

  try {
    await updateDailyLogDraft(req.params.id, dateStr, parsed.data);
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
  await recordAuditEvent({
    actorId: req.user!.id,
    action: "DAILY_LOG_UPDATE",
    entityType: "daily_log",
    entityId: req.params.id,
  });
  const detail = await getDailyLogDetail(req.user!, req.params.id);
  res.json({ dailyLog: detail });
});

// Fait passer un brouillon a SUBMITTED. Refuse (409) si le journal n'est
// deja plus un brouillon -- une soumission ne se rejoue pas.
dailyLogsRouter.post("/:id/submit", canWrite, async (req, res) => {
  const log = await findDailyLogForMutation(req.user!, req.params.id);
  if (log === null) {
    res.status(404).json({ error: "Journal introuvable." });
    return;
  }
  if (log === "forbidden") {
    res.status(403).json({ error: "Acces refuse a ce journal." });
    return;
  }
  if (log.status !== "DRAFT") {
    res.status(409).json({ error: "Ce journal a deja ete soumis ou valide." });
    return;
  }

  await submitDailyLog(req.params.id);
  await recordAuditEvent({
    actorId: req.user!.id,
    action: "DAILY_LOG_SUBMIT",
    entityType: "daily_log",
    entityId: req.params.id,
  });
  const detail = await getDailyLogDetail(req.user!, req.params.id);
  res.json({ dailyLog: detail });
});

// Multer transforme un fichier refuse (type ou taille) en erreur passee a
// next() -- on l'intercepte ici pour repondre 400 proprement plutot que de
// laisser remonter une erreur non geree.
function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }
    if (err.message === "UNSUPPORTED_MIME_TYPE") {
      res.status(400).json({ error: "Type de fichier non supporte (JPEG, PNG, WEBP ou PDF uniquement)." });
      return;
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Fichier trop volumineux (10 Mo maximum)." });
      return;
    }
    res.status(400).json({ error: "Echec de l'upload." });
  });
}

// Ajoute une piece jointe (photo de chantier, PDF) a un brouillon. Le
// fichier est ecrit sur le stockage local (voir src/storage/) puis
// seulement ses metadonnees + une storage_key opaque vont en base --
// jamais de blob dans la table, comme prevu au modele de donnees.
// Reservee, comme les autres ecritures, a un journal encore DRAFT et
// accessible par l'utilisateur.
dailyLogsRouter.post("/:id/attachments", canWrite, handleUpload, async (req, res) => {
  const log = await findDailyLogForMutation(req.user!, req.params.id);
  if (log === null) {
    res.status(404).json({ error: "Journal introuvable." });
    return;
  }
  if (log === "forbidden") {
    res.status(403).json({ error: "Acces refuse a ce journal." });
    return;
  }
  if (log.status !== "DRAFT") {
    res.status(409).json({ error: "Les pieces jointes ne peuvent etre ajoutees que sur un brouillon." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Fichier manquant (champ "file").' });
    return;
  }

  const storageKey = await saveFile(req.file.buffer);
  const attachment = await addAttachment({
    dailyLogId: req.params.id,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    storageKey,
  });
  await recordAuditEvent({
    actorId: req.user!.id,
    action: "DAILY_LOG_ATTACHMENT_ADD",
    entityType: "daily_log",
    entityId: req.params.id,
    metadata: { attachmentId: attachment.id, fileName: attachment.file_name },
  });
  const detail = await getDailyLogDetail(req.user!, req.params.id);
  res.status(201).json({ dailyLog: detail });
});

// Supprime une piece jointe d'un brouillon (fichier + ligne en base).
dailyLogsRouter.delete("/:id/attachments/:attachmentId", canWrite, async (req, res) => {
  const log = await findDailyLogForMutation(req.user!, req.params.id);
  if (log === null) {
    res.status(404).json({ error: "Journal introuvable." });
    return;
  }
  if (log === "forbidden") {
    res.status(403).json({ error: "Acces refuse a ce journal." });
    return;
  }
  if (log.status !== "DRAFT") {
    res.status(409).json({ error: "Les pieces jointes ne peuvent etre retirees que d'un brouillon." });
    return;
  }

  const attachment = await findAttachmentById(req.params.attachmentId);
  if (!attachment || attachment.daily_log_id !== req.params.id) {
    res.status(404).json({ error: "Piece jointe introuvable." });
    return;
  }

  const deleted = await deleteAttachment(req.params.attachmentId);
  if (deleted) {
    await deleteStoredFile(deleted.storage_key);
  }
  await recordAuditEvent({
    actorId: req.user!.id,
    action: "DAILY_LOG_ATTACHMENT_DELETE",
    entityType: "daily_log",
    entityId: req.params.id,
    metadata: { attachmentId: req.params.attachmentId },
  });
  const detail = await getDailyLogDetail(req.user!, req.params.id);
  res.json({ dailyLog: detail });
});

// Valide ou renvoie un journal SUBMITTED. Un renvoi le remet en DRAFT --
// le chef de chantier pourra alors le corriger (PATCH) et le resoumettre.
// Refuse (409) sur tout journal qui n'est pas SUBMITTED : on ne valide pas
// un brouillon, et on ne revalide pas un journal deja valide.
dailyLogsRouter.post("/:id/review", canReview, async (req, res) => {
  const log = await findDailyLogForMutation(req.user!, req.params.id);
  if (log === null) {
    res.status(404).json({ error: "Journal introuvable." });
    return;
  }
  if (log === "forbidden") {
    res.status(403).json({ error: "Acces refuse a ce journal." });
    return;
  }
  if (log.status !== "SUBMITTED") {
    res.status(409).json({ error: "Seul un journal soumis peut etre valide ou renvoye." });
    return;
  }

  const parsed = reviewDailyLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.flatten() });
    return;
  }

  await reviewDailyLog(req.params.id, req.user!.id, parsed.data);
  await recordAuditEvent({
    actorId: req.user!.id,
    action: parsed.data.decision === "VALIDATED" ? "DAILY_LOG_VALIDATE" : "DAILY_LOG_RETURN",
    entityType: "daily_log",
    entityId: req.params.id,
    metadata: parsed.data.comment ? { comment: parsed.data.comment } : undefined,
  });
  const detail = await getDailyLogDetail(req.user!, req.params.id);
  res.json({ dailyLog: detail });
});
