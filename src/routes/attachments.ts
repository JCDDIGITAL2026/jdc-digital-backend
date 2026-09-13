import { Router } from "express";
import { findAttachmentById } from "../db/repositories";
import { verifySignedDownload } from "../storage/signedUrl";
import { readStoredFile } from "../storage/fileStorage";

// Route de telechargement des pieces jointes -- volontairement HORS de
// /api et de requireAuth : comme une URL presignee S3, l'autorisation
// tient entierement dans la signature du lien (voir storage/signedUrl.ts),
// pas dans un cookie de session. Le lien n'est distribue que par
// GET /api/daily-logs/:id (attachments[].downloadUrl), apres verification
// normale des droits sur ce journal -- jamais devine ni enumerable (id
// aleatoire + signature).
export const attachmentsRouter = Router();

attachmentsRouter.get("/:id/download", async (req, res) => {
  const attachment = await findAttachmentById(req.params.id);
  if (!attachment) {
    res.status(404).json({ error: "Piece jointe introuvable." });
    return;
  }

  const valid = verifySignedDownload(req.params.id, req.query.exp, req.query.sig);
  if (!valid) {
    res.status(403).json({ error: "Lien de telechargement invalide ou expire." });
    return;
  }

  try {
    const buffer = await readStoredFile(attachment.storage_key);
    res.setHeader("Content-Type", attachment.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${attachment.file_name}"`);
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "Fichier introuvable sur le stockage." });
  }
});
