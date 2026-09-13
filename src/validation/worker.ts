import { z } from "zod";

// Meme heuristique que celle validee sur Pilotis : ces mots-cles dans la
// qualification indiquent une main-d'oeuvre indirecte (encadrement,
// manutention transversale) plutot qu'une main-d'oeuvre directe rattachee
// a une tache precise. Modifiable ensuite manuellement.
const MOID_KEYWORDS = [
  "chef",
  "conducteur",
  "grutier",
  "magasinier",
  "gardien",
  "encadrement",
  "pointeur",
  "chauffeur",
];

export function inferNature(qualification: string): "MOD" | "MOID" {
  const q = qualification.toLowerCase();
  return MOID_KEYWORDS.some((k) => q.includes(k)) ? "MOID" : "MOD";
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");

export const createWorkerSchema = z.object({
  matricule: z.string().min(1).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  qualification: z.string().min(1),
  nature: z.enum(["MOD", "MOID"]).optional(),
  entryDate: dateSchema.optional(),
});

export const updateWorkerSchema = z.object({
  matricule: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  qualification: z.string().min(1).optional(),
  nature: z.enum(["MOD", "MOID"]).optional(),
  entryDate: dateSchema.optional(),
  active: z.boolean().optional(),
});

export type CreateWorkerInput = z.infer<typeof createWorkerSchema>;
export type UpdateWorkerInput = z.infer<typeof updateWorkerSchema>;
