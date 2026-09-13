import { z } from "zod";

// Schemas partages entre creation et mise a jour d'un brouillon de journal.
// Les tableaux teams/works/incidents/attendances sont remplaces en bloc a
// chaque ecriture (pas de patch ligne a ligne) -- plus simple, et suffisant
// tant que la saisie se fait via un seul formulaire de brouillon.

const teamSchema = z.object({
  company: z.string().min(1),
  trade: z.string().min(1),
  headcount: z.number().int().nonnegative(),
  hours: z.number().nonnegative(),
});

const workSchema = z.object({
  zone: z.string().min(1),
  description: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1),
  progressPct: z.number().int().min(0).max(100),
  // Rendement de reference (unites/heure) -- absent = "reference non
  // saisie" au rapport, comme dans Pilotis. Jamais recalcule ici : c'est
  // une donnee metier saisie a part (nomenclature de taches), pas deduite.
  referenceRate: z.number().positive().optional(),
});

const incidentSchema = z.object({
  type: z.string().min(1),
  severity: z.string().min(1),
  description: z.string().min(1),
  action: z.string().optional(),
  status: z.string().min(1),
});

// Le pointage nominatif du jour. workIndex pointe vers l'index (0-based)
// de la tache dans le tableau "works" ci-dessus -- les works n'ont pas
// encore d'id cote client au moment de l'envoi (ils sont recrees a chaque
// ecriture), donc on les reference par position plutot que par id.
// Absent = ouvrier pointe sans tache assignee (remonte en anomalie).
const attendanceSchema = z.object({
  workerId: z.string().min(1),
  hours: z.number().positive(),
  workIndex: z.number().int().nonnegative().optional(),
});

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");

const baseDailyLogFields = {
  weather: z.string().optional(),
  tempMin: z.number().int().optional(),
  tempMax: z.number().int().optional(),
  managerName: z.string().optional(),
  observations: z.string().optional(),
  teams: z.array(teamSchema).default([]),
  works: z.array(workSchema).default([]),
  incidents: z.array(incidentSchema).default([]),
  attendances: z.array(attendanceSchema).default([]),
};

// Un workIndex doit designer une tache reellement presente dans "works",
// et un meme ouvrier ne peut apparaitre qu'une fois dans le pointage du
// jour (un doublon serait de toute facon rejete par la contrainte unique
// (worker_id, date) en base, mais autant le signaler clairement en 400).
function checkAttendances(
  data: { works: unknown[]; attendances: { workerId: string; workIndex?: number }[] },
  ctx: z.RefinementCtx
) {
  data.attendances.forEach((a, idx) => {
    if (a.workIndex !== undefined && a.workIndex >= data.works.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `attendances[${idx}].workIndex ne correspond a aucune tache de "works".`,
        path: ["attendances", idx, "workIndex"],
      });
    }
  });
  const seen = new Set<string>();
  data.attendances.forEach((a, idx) => {
    if (seen.has(a.workerId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `attendances[${idx}] : cet ouvrier apparait deja dans le pointage du jour.`,
        path: ["attendances", idx, "workerId"],
      });
    }
    seen.add(a.workerId);
  });
}

export const createDailyLogSchema = z
  .object({
    projectId: z.string().min(1),
    date: dateSchema,
    ...baseDailyLogFields,
  })
  .superRefine(checkAttendances);

// projectId et date sont fixes a la creation (ce sont eux qui portent la
// contrainte d'unicite) -- une mise a jour ne les modifie pas.
export const updateDailyLogSchema = z
  .object({ ...baseDailyLogFields })
  .superRefine(checkAttendances);

export type CreateDailyLogInput = z.infer<typeof createDailyLogSchema>;
export type UpdateDailyLogInput = z.infer<typeof updateDailyLogSchema>;

// Un renvoi (RETURNED) doit toujours porter un commentaire -- c'est ce que
// le chef de chantier lira pour savoir quoi corriger avant de resoumettre.
// Une validation peut rester silencieuse (commentaire optionnel).
export const reviewDailyLogSchema = z
  .object({
    decision: z.enum(["VALIDATED", "RETURNED"]),
    comment: z.string().min(1).optional(),
  })
  .refine((v) => v.decision !== "RETURNED" || !!v.comment, {
    message: "Un commentaire est requis pour renvoyer un journal.",
    path: ["comment"],
  });

export type ReviewDailyLogInput = z.infer<typeof reviewDailyLogSchema>;
