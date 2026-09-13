import type { PoolClient } from "pg";
import { query, withTransaction } from "./pool";
import type {
  CreateDailyLogInput,
  UpdateDailyLogInput,
  ReviewDailyLogInput,
} from "../validation/dailyLog";
import { inferNature, type CreateWorkerInput, type UpdateWorkerInput } from "../validation/worker";
import { createSignedDownloadPath } from "../storage/signedUrl";

// Leve quand une ecriture viole la contrainte unique (project_id, date) --
// la route la traduit en 409 plutot que de laisser fuiter une erreur pg brute.
export class ConflictError extends Error {}

export type Role = "ADMIN" | "DIRECTION" | "CHEF_CHANTIER" | "LECTEUR";

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  entraObjectId: string | null;
  role: Role;
  active: boolean;
}

function mapUser(row: any): AppUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    entraObjectId: row.entra_object_id,
    role: row.role,
    active: row.active,
  };
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const { rows } = await query(
    "select * from users where email = $1 and active = true",
    [email]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findUserByEntraObjectId(
  entraObjectId: string
): Promise<AppUser | null> {
  const { rows } = await query(
    "select * from users where entra_object_id = $1 and active = true",
    [entraObjectId]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const { rows } = await query(
    "select * from users where id = $1 and active = true",
    [id]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

// Chantiers auxquels un utilisateur a acces :
// - ADMIN / DIRECTION / LECTEUR voient tous les chantiers actifs ;
// - CHEF_CHANTIER ne voit que les chantiers ou il a une ligne project_members.
// C'est la regle qui manquait entierement cote serveur dans le prototype
// JDC Digital (le filtrage n'existait que dans l'interface).
export async function listAccessibleProjects(user: AppUser) {
  if (user.role === "CHEF_CHANTIER") {
    const { rows } = await query(
      `select p.* from projects p
       join project_members pm on pm.project_id = p.id
       where pm.user_id = $1
       order by p.name`,
      [user.id]
    );
    return rows;
  }
  const { rows } = await query("select * from projects order by name");
  return rows;
}

// Renvoie true si l'utilisateur a le droit de voir/agir sur ce chantier precis.
// Utilise par les routes de detail pour ne jamais faire confiance a un id
// fourni par le client sans le confronter a la base.
export async function userCanAccessProject(
  user: AppUser,
  projectId: string
): Promise<boolean> {
  if (user.role !== "CHEF_CHANTIER") return true;
  const { rows } = await query(
    "select 1 from project_members where user_id = $1 and project_id = $2",
    [user.id, projectId]
  );
  return rows.length > 0;
}

export async function listDailyLogsForUser(
  user: AppUser,
  filters: { projectId?: string; from?: string; to?: string } = {}
) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (user.role === "CHEF_CHANTIER") {
    params.push(user.id);
    conditions.push(
      `dl.project_id in (select project_id from project_members where user_id = $${params.length})`
    );
  }
  if (filters.projectId) {
    params.push(filters.projectId);
    conditions.push(`dl.project_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`dl.date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`dl.date <= $${params.length}`);
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const { rows } = await query(
    `select dl.*, p.name as project_name, p.code as project_code
     from daily_logs dl
     join projects p on p.id = dl.project_id
     ${where}
     order by dl.date desc`,
    params
  );
  return rows;
}

export async function getDailyLogDetail(user: AppUser, dailyLogId: string) {
  const { rows } = await query(
    `select dl.*, p.name as project_name, p.code as project_code
     from daily_logs dl
     join projects p on p.id = dl.project_id
     where dl.id = $1`,
    [dailyLogId]
  );
  const log = rows[0];
  if (!log) return null;

  if (!(await userCanAccessProject(user, log.project_id))) {
    return "forbidden" as const;
  }

  const [teams, works, incidents, attachments, reviews] = await Promise.all([
    query("select * from daily_log_teams where daily_log_id = $1", [dailyLogId]),
    query("select * from daily_log_works where daily_log_id = $1", [dailyLogId]),
    query("select * from daily_log_incidents where daily_log_id = $1", [dailyLogId]),
    query(
      "select id, file_name, mime_type, size_bytes, created_at from daily_log_attachments where daily_log_id = $1 order by created_at",
      [dailyLogId]
    ),
    query(
      `select r.*, u.display_name as reviewer_name from daily_log_reviews r
       join users u on u.id = r.reviewer_id
       where r.daily_log_id = $1 order by r.created_at desc`,
      [dailyLogId]
    ),
  ]);

  const attendancesRes = await query(
    `select da.*, w.first_name, w.last_name, w.matricule, w.nature, w.qualification
     from daily_log_attendances da
     join workers w on w.id = da.worker_id
     where da.daily_log_id = $1
     order by w.last_name, w.first_name`,
    [dailyLogId]
  );
  const attendances = attendancesRes.rows;

  // Rendement reel = quantite / heures pointees sur la tache ; ecart vs
  // reference seulement quand une reference a ete saisie ("reference non
  // saisie" sinon, comme dans Pilotis). La liste nominative par tache
  // reprend directement le pointage du jour.
  const worksWithRendement = works.rows.map((w: any) => {
    const assigned = attendances.filter((a: any) => a.work_id === w.id);
    const totalHours = assigned.reduce((sum: number, a: any) => sum + Number(a.hours), 0);
    const rendementReel = totalHours > 0 ? w.quantity / totalHours : null;
    const ecartPct =
      w.reference_rate != null && rendementReel != null
        ? ((rendementReel - w.reference_rate) / w.reference_rate) * 100
        : null;
    return {
      ...w,
      workers: assigned.map((a: any) => ({
        workerId: a.worker_id,
        name: `${a.first_name} ${a.last_name}`,
        matricule: a.matricule,
        qualification: a.qualification,
        hours: Number(a.hours),
      })),
      totalHours,
      rendementReel,
      ecartPct,
    };
  });

  // Heures normales fixees a 8h/jour -- seuil simple pour cet increment,
  // ajustable plus tard sans changer le modele (les heures pointees, elles,
  // sont la donnee source).
  const HEURES_NORMALES_JOUR = 8;
  const pointage = attendances.map((a: any) => ({
    workerId: a.worker_id,
    name: `${a.first_name} ${a.last_name}`,
    matricule: a.matricule,
    nature: a.nature,
    qualification: a.qualification,
    hours: Number(a.hours),
    heuresSup: Math.max(0, Number(a.hours) - HEURES_NORMALES_JOUR),
    workId: a.work_id,
  }));

  const heuresParQualification: Record<string, number> = {};
  for (const p of pointage) {
    heuresParQualification[p.qualification] = (heuresParQualification[p.qualification] ?? 0) + p.hours;
  }

  // Un lien de telechargement signe, court (15 min), genere a la volee a
  // chaque lecture -- jamais stocke, jamais le storage_key expose au client
  // (voir migration 001 : "jamais de blob stocke... storage_key pointe
  // vers l'objet").
  const attachmentsWithUrl = attachments.rows.map((a: any) => ({
    ...a,
    downloadUrl: createSignedDownloadPath(a.id),
  }));

  return {
    ...log,
    teams: teams.rows,
    works: worksWithRendement,
    incidents: incidents.rows,
    attachments: attachmentsWithUrl,
    reviews: reviews.rows,
    pointage,
    heuresParQualification,
    anomalies: {
      // MOD pointe sans tache assignee -- normal pour un MOID (encadrement).
      modSansTache: pointage.filter((p) => p.nature === "MOD" && !p.workId),
      // Tache sans aucun ouvrier pointe dessus.
      tacheSansPointage: worksWithRendement.filter((w) => w.workers.length === 0),
    },
  };
}

// Remplace en bloc les lignes enfants d'un journal (equipes/travaux/
// incidents/pointage). Plus simple qu'un patch ligne a ligne, et suffisant
// tant que la saisie se fait via un seul formulaire de brouillon soumis en
// entier. "date" est la date du journal (daily_logs.date) -- necessaire
// pour porter la contrainte "un ouvrier pointe une fois par jour, tous
// chantiers confondus".
async function replaceDailyLogChildren(
  client: PoolClient,
  dailyLogId: string,
  date: string,
  input: {
    teams: CreateDailyLogInput["teams"];
    works: CreateDailyLogInput["works"];
    incidents: CreateDailyLogInput["incidents"];
    attendances: CreateDailyLogInput["attendances"];
  }
) {
  // Le pointage reference les taches par position (workIndex) : il doit
  // etre efface avant les taches elles-memes pour ne jamais pointer vers
  // une ligne qui va disparaitre, et reinsere apres les nouvelles taches.
  await client.query("delete from daily_log_attendances where daily_log_id = $1", [dailyLogId]);
  await client.query("delete from daily_log_teams where daily_log_id = $1", [dailyLogId]);
  await client.query("delete from daily_log_works where daily_log_id = $1", [dailyLogId]);
  await client.query("delete from daily_log_incidents where daily_log_id = $1", [dailyLogId]);

  for (const t of input.teams) {
    await client.query(
      `insert into daily_log_teams (daily_log_id, company, trade, headcount, hours) values ($1, $2, $3, $4, $5)`,
      [dailyLogId, t.company, t.trade, t.headcount, t.hours]
    );
  }

  const workIds: string[] = [];
  for (const w of input.works) {
    const { rows } = await client.query(
      `insert into daily_log_works (daily_log_id, zone, description, quantity, unit, progress_pct, reference_rate)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [dailyLogId, w.zone, w.description, w.quantity, w.unit, w.progressPct, w.referenceRate ?? null]
    );
    workIds.push(rows[0].id);
  }

  for (const i of input.incidents) {
    await client.query(
      `insert into daily_log_incidents (daily_log_id, type, severity, description, action, status) values ($1, $2, $3, $4, $5, $6)`,
      [dailyLogId, i.type, i.severity, i.description, i.action ?? null, i.status]
    );
  }

  for (const a of input.attendances) {
    const workId = a.workIndex !== undefined ? workIds[a.workIndex] : null;
    // Verifie explicitement avant d'inserer (plutot que de laisser fuiter
    // l'erreur pg brute de la contrainte unique) pour pouvoir nommer le
    // chantier concerne, comme le faisait deja Pilotis cote interface.
    const conflict = await client.query(
      `select p.name as project_name from daily_log_attendances da
       join daily_logs dl on dl.id = da.daily_log_id
       join projects p on p.id = dl.project_id
       where da.worker_id = $1 and da.date = $2`,
      [a.workerId, date]
    );
    if (conflict.rows[0]) {
      throw new ConflictError(
        `Cet ouvrier est deja pointe le ${date} sur le chantier "${conflict.rows[0].project_name}".`
      );
    }
    await client.query(
      `insert into daily_log_attendances (daily_log_id, worker_id, work_id, date, hours) values ($1, $2, $3, $4, $5)`,
      [dailyLogId, a.workerId, workId, date, a.hours]
    );
  }
}

// Cree un brouillon. La contrainte d'unicite (project_id, date) est imposee
// par la base -- une violation devient un ConflictError propre plutot qu'une
// erreur pg brute qui remonterait jusqu'au client.
export async function createDailyLogDraft(
  user: AppUser,
  input: CreateDailyLogInput
): Promise<string> {
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `insert into daily_logs
           (project_id, date, weather, temp_min, temp_max, manager_name, observations, author_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          input.projectId,
          input.date,
          input.weather ?? null,
          input.tempMin ?? null,
          input.tempMax ?? null,
          input.managerName ?? null,
          input.observations ?? null,
          user.id,
        ]
      );
      const dailyLogId: string = rows[0].id;
      await replaceDailyLogChildren(client, dailyLogId, input.date, input);
      return dailyLogId;
    });
  } catch (err: any) {
    if (err instanceof ConflictError) throw err;
    if (err?.code === "23505") {
      throw new ConflictError(
        "Un journal existe deja pour ce chantier a cette date."
      );
    }
    throw err;
  }
}

// Charge un journal pour une ecriture (update/submit) en verifiant l'acces
// au chantier -- meme logique de cloisonnement que la lecture, jamais
// relachee pour les routes d'ecriture.
export async function findDailyLogForMutation(user: AppUser, dailyLogId: string) {
  const { rows } = await query("select * from daily_logs where id = $1", [dailyLogId]);
  const log = rows[0];
  if (!log) return null;
  if (!(await userCanAccessProject(user, log.project_id))) {
    return "forbidden" as const;
  }
  return log;
}

// Reserve aux journaux encore au statut DRAFT -- verifie par l'appelant
// (la route) avant d'invoquer cette fonction. "date" est la date du
// journal (immuable apres creation), passee par l'appelant qui l'a deja
// sous la main via findDailyLogForMutation -- pas de requete en plus ici.
export async function updateDailyLogDraft(
  dailyLogId: string,
  date: string,
  input: UpdateDailyLogInput
) {
  await withTransaction(async (client) => {
    await client.query(
      `update daily_logs
         set weather = $2, temp_min = $3, temp_max = $4, manager_name = $5,
             observations = $6, updated_at = now()
       where id = $1`,
      [
        dailyLogId,
        input.weather ?? null,
        input.tempMin ?? null,
        input.tempMax ?? null,
        input.managerName ?? null,
        input.observations ?? null,
      ]
    );
    await replaceDailyLogChildren(client, dailyLogId, date, input);
  });
}

export async function submitDailyLog(dailyLogId: string) {
  await query(
    `update daily_logs
       set status = 'SUBMITTED', submitted_at = now(), updated_at = now()
     where id = $1`,
    [dailyLogId]
  );
}

// Valide ou renvoie un journal SUBMITTED (verifie par l'appelant avant
// d'invoquer cette fonction). Une validation fige le journal (VALIDATED,
// validated_at) ; un renvoi le remet en brouillon pour correction -- il
// redevient donc modifiable et resoumisible par le chef de chantier.
// La ligne daily_log_reviews garde la trace des deux cas, y compris les
// allers-retours successifs.
export async function reviewDailyLog(
  dailyLogId: string,
  reviewerId: string,
  input: ReviewDailyLogInput
) {
  await withTransaction(async (client) => {
    await client.query(
      `insert into daily_log_reviews (daily_log_id, reviewer_id, decision, comment)
       values ($1, $2, $3, $4)`,
      [dailyLogId, reviewerId, input.decision, input.comment ?? null]
    );
    if (input.decision === "VALIDATED") {
      await client.query(
        `update daily_logs set status = 'VALIDATED', validated_at = now(), updated_at = now() where id = $1`,
        [dailyLogId]
      );
    } else {
      await client.query(
        `update daily_logs
           set status = 'DRAFT', submitted_at = null, updated_at = now()
         where id = $1`,
        [dailyLogId]
      );
    }
  });
}

// Registre nominatif des ouvriers -- global, pas rattache a un chantier
// (voir migration 002 : c'est ce qui permet d'imposer l'exclusivite
// "un ouvrier, un chantier, par jour" au niveau base).

export async function listWorkers(filters: { active?: boolean } = {}) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (filters.active !== undefined) {
    params.push(filters.active);
    conditions.push(`active = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const { rows } = await query(
    `select * from workers ${where} order by last_name, first_name`,
    params
  );
  return rows;
}

export async function createWorker(input: CreateWorkerInput) {
  const nature = input.nature ?? inferNature(input.qualification);
  const { rows } = await query(
    `insert into workers (matricule, first_name, last_name, nature, qualification, entry_date)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.matricule ?? null,
      input.firstName,
      input.lastName,
      nature,
      input.qualification,
      input.entryDate ?? null,
    ]
  );
  return rows[0];
}

export async function updateWorker(workerId: string, input: UpdateWorkerInput) {
  const { rows: existingRows } = await query("select * from workers where id = $1", [workerId]);
  const existing = existingRows[0];
  if (!existing) return null;

  const nature = input.nature ?? (input.qualification ? inferNature(input.qualification) : existing.nature);
  const { rows } = await query(
    `update workers
       set matricule = $2, first_name = $3, last_name = $4, nature = $5,
           qualification = $6, entry_date = $7, active = $8, updated_at = now()
     where id = $1
     returning *`,
    [
      workerId,
      input.matricule !== undefined ? input.matricule : existing.matricule,
      input.firstName ?? existing.first_name,
      input.lastName ?? existing.last_name,
      nature,
      input.qualification ?? existing.qualification,
      input.entryDate !== undefined ? input.entryDate : existing.entry_date,
      input.active !== undefined ? input.active : existing.active,
    ]
  );
  return rows[0];
}

// Pieces jointes -- le fichier lui-meme est ecrit sur le stockage (voir
// src/storage/) avant cet appel ; ici on n'enregistre que les metadonnees
// et la storage_key opaque qui permet de le retrouver.
export async function addAttachment(params: {
  dailyLogId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}) {
  const { rows } = await query(
    `insert into daily_log_attachments (daily_log_id, file_name, mime_type, size_bytes, storage_key)
     values ($1, $2, $3, $4, $5)
     returning id, file_name, mime_type, size_bytes, created_at`,
    [params.dailyLogId, params.fileName, params.mimeType, params.sizeBytes, params.storageKey]
  );
  return rows[0];
}

// Renvoie la ligne complete (storage_key inclus) -- reservee au usage
// interne des routes de telechargement/suppression, jamais serialisee
// telle quelle dans une reponse JSON.
export async function findAttachmentById(attachmentId: string) {
  const { rows } = await query("select * from daily_log_attachments where id = $1", [attachmentId]);
  return rows[0] ?? null;
}

export async function deleteAttachment(attachmentId: string) {
  const { rows } = await query(
    "delete from daily_log_attachments where id = $1 returning storage_key",
    [attachmentId]
  );
  return rows[0] ?? null;
}

export async function recordAuditEvent(params: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await query(
    `insert into audit_events (actor_id, action, entity_type, entity_id, metadata)
     values ($1, $2, $3, $4, $5)`,
    [
      params.actorId,
      params.action,
      params.entityType,
      params.entityId,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]
  );
}
