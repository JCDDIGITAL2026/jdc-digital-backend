import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Stockage local, zero cout, pour le developpement dans cet environnement.
// En production, ce module est remplace par un vrai stockage objet prive
// (S3/Blob) -- le reste de l'application (routes, base de donnees) ne
// connait qu'une "storage_key" opaque, jamais un chemin disque : le
// remplacement ne touche que ce fichier.
//
// Le repertoire est configurable (ATTACHMENTS_DIR) pour ne jamais l'ecrire
// par defaut dans un chemin surprenant ; par defaut a cote du code source.
const STORAGE_DIR = process.env.ATTACHMENTS_DIR || path.join(process.cwd(), "storage", "attachments");

async function ensureDir() {
  await mkdir(STORAGE_DIR, { recursive: true });
}

// storage_key = <uuid> seul (pas d'extension, pas le nom original) --
// evite tout risque de traversee de chemin (../..) a partir d'une entree
// utilisateur, puisque la valeur n'est jamais derivee du nom de fichier
// envoye par le client.
export async function saveFile(buffer: Buffer): Promise<string> {
  await ensureDir();
  const storageKey = randomUUID();
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer);
  return storageKey;
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(path.join(STORAGE_DIR, storageKey));
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  await unlink(path.join(STORAGE_DIR, storageKey)).catch(() => {
    // Deja absent -- pas bloquant, l'entree base est la source de verite.
  });
}
