import { createHmac, timingSafeEqual } from "node:crypto";

// Imite ce qu'un vrai stockage objet (S3/Blob) ferait avec une URL
// pre-signee : un lien a duree de vie courte, verifiable sans session,
// qui donne acces a UNE piece jointe precise et rien d'autre. Le HMAC est
// calcule sur l'id de la piece jointe + son expiration -- un lien ne peut
// donc pas etre reutilise pour une autre piece jointe, ni rester valide
// indefiniment.
//
// En production avec un vrai stockage objet, ce module disparait : c'est
// le fournisseur (S3 getSignedUrl, Blob SAS token...) qui genere le lien.

const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes, comme une URL presignee typique.

function sign(attachmentId: string, expiresAt: number): string {
  const secret = process.env.SESSION_SECRET || "dev-only-secret-change-me";
  return createHmac("sha256", secret)
    .update(`${attachmentId}.${expiresAt}`)
    .digest("hex");
}

export function createSignedDownloadPath(attachmentId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const signature = sign(attachmentId, expiresAt);
  return `/attachments/${attachmentId}/download?exp=${expiresAt}&sig=${signature}`;
}

export function verifySignedDownload(attachmentId: string, expiresAtRaw: unknown, signatureRaw: unknown): boolean {
  if (typeof expiresAtRaw !== "string" || typeof signatureRaw !== "string") return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = sign(attachmentId, expiresAt);
  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(signatureRaw, "hex");
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}
