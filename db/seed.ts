// Jeu de donnees de developpement : utilisateurs, chantiers, affectations,
// et deux journaux d'exemple. Aucune donnee reelle -- noms fictifs comme
// dans le prototype JDC Digital d'origine.
// Exporte seedDatabase() pour etre reutilise tel quel par les tests
// automatiques (contre la base jdc_test), et s'auto-execute en CLI
// (contre la base pointee par DATABASE_URL) via `npm run seed`.
import "dotenv/config";
import { query } from "../src/db/pool";

export async function seedDatabase() {
  await query(
    `truncate table audit_events, daily_log_reviews, daily_log_attachments,
     daily_log_attendances, daily_log_incidents, daily_log_works,
     daily_log_teams, daily_logs, project_members, projects, workers, users
     restart identity cascade`
  );

  const users = [
    { email: "admin@jdc-digital.local", name: "Admin Systeme", role: "ADMIN" },
    { email: "direction@jdc-digital.local", name: "Youness El Ouarouari", role: "DIRECTION" },
    { email: "chef.atlas@jdc-digital.local", name: "M. Amrani", role: "CHEF_CHANTIER" },
    { email: "chef.oasis@jdc-digital.local", name: "S. Kabbaj", role: "CHEF_CHANTIER" },
    { email: "lecteur@jdc-digital.local", name: "Lecteur Audit", role: "LECTEUR" },
  ] as const;

  const userIds: Record<string, string> = {};
  for (const u of users) {
    const { rows } = await query(
      `insert into users (email, display_name, role) values ($1, $2, $3) returning id`,
      [u.email, u.name, u.role]
    );
    userIds[u.email] = rows[0].id;
  }

  const projects = [
    { name: "Résidence Atlas", code: "CH-AT-026", location: "Marrakech" },
    { name: "Hôtel Oasis", code: "CH-HO-014", location: "Agafay" },
    { name: "Voirie Al Amal", code: "CH-VA-031", location: "Marrakech" },
  ];
  const projectIds: Record<string, string> = {};
  for (const p of projects) {
    const { rows } = await query(
      `insert into projects (name, code, location) values ($1, $2, $3) returning id`,
      [p.name, p.code, p.location]
    );
    projectIds[p.code] = rows[0].id;
  }

  await query(
    `insert into project_members (user_id, project_id) values ($1, $2)`,
    [userIds["chef.atlas@jdc-digital.local"], projectIds["CH-AT-026"]]
  );
  await query(
    `insert into project_members (user_id, project_id) values ($1, $2)`,
    [userIds["chef.oasis@jdc-digital.local"], projectIds["CH-HO-014"]]
  );

  // Registre nominatif -- nature deduite de la qualification quand elle
  // n'est pas explicite, comme sur Pilotis (chef -> MOID par exemple).
  const workers = [
    { matricule: "OUV-001", firstName: "Hassan", lastName: "Idrissi", qualification: "Coffreur", nature: "MOD" },
    { matricule: "OUV-002", firstName: "Youssef", lastName: "Amine", qualification: "Coffreur", nature: "MOD" },
    { matricule: "OUV-003", firstName: "Karim", lastName: "Ziani", qualification: "Ferrailleur", nature: "MOD" },
    { matricule: "OUV-004", firstName: "Rachid", lastName: "Amrani", qualification: "Chef d'équipe coffrage", nature: "MOID" },
    { matricule: "OUV-005", firstName: "Omar", lastName: "Bensaid", qualification: "Maçon", nature: "MOD" },
    { matricule: "OUV-006", firstName: "Said", lastName: "Fassi", qualification: "Maçon", nature: "MOD" },
  ] as const;
  const workerIds: Record<string, string> = {};
  for (const w of workers) {
    const { rows } = await query(
      `insert into workers (matricule, first_name, last_name, nature, qualification) values ($1, $2, $3, $4, $5) returning id`,
      [w.matricule, w.firstName, w.lastName, w.nature, w.qualification]
    );
    workerIds[w.matricule] = rows[0].id;
  }

  const { rows: logRows } = await query(
    `insert into daily_logs (project_id, date, status, weather, temp_min, temp_max, manager_name, observations, author_id, submitted_at)
     values ($1, current_date, 'SUBMITTED', 'Ensoleillé', 23, 37, 'M. Amrani', 'Coulage prévu demain sous réserve de réception de l''acier.', $2, now())
     returning id`,
    [projectIds["CH-AT-026"], userIds["chef.atlas@jdc-digital.local"]]
  );
  const logId = logRows[0].id;
  await query(
    `insert into daily_log_teams (daily_log_id, company, trade, headcount, hours) values
     ($1, 'Entreprise pilote', 'Coffrage', 12, 8),
     ($1, 'Sous-traitant A', 'Ferraillage', 8, 8)`,
    [logId]
  );
  const { rows: workRows } = await query(
    `insert into daily_log_works (daily_log_id, zone, description, quantity, unit, progress_pct, reference_rate) values
     ($1, 'Bloc A · Sous-sol', 'Coffrage des voiles périphériques', 42, 'm²', 80, 2.5)
     returning id`,
    [logId]
  );
  const workId = workRows[0].id;
  await query(
    `insert into daily_log_incidents (daily_log_id, type, severity, description, action, status) values
     ($1, 'Approvisionnement', 'Moyen', 'Livraison d''acier décalée de deux heures', 'Séquence de coffrage réorganisée', 'En cours')`,
    [logId]
  );
  // Pointage nominatif : deux coffreurs sur la tâche (rendement réel calculé
  // à partir de leurs heures) ; un ferrailleur et le chef d'équipe pointés
  // sans tâche assignée -- le premier remonte en anomalie (MOD sans tâche),
  // pas le second (MOID, encadrement, c'est attendu).
  await query(
    `insert into daily_log_attendances (daily_log_id, worker_id, work_id, date, hours) values
     ($1, $2, $3, current_date, 8),
     ($1, $4, $3, current_date, 8),
     ($1, $5, null, current_date, 8),
     ($1, $6, null, current_date, 9)`,
    [logId, workerIds["OUV-001"], workId, workerIds["OUV-002"], workerIds["OUV-003"], workerIds["OUV-004"]]
  );

  const { rows: logRows2 } = await query(
    `insert into daily_logs (project_id, date, status, weather, temp_min, temp_max, manager_name, observations, author_id, submitted_at, validated_at)
     values ($1, current_date - interval '1 day', 'VALIDATED', 'Chaleur forte', 24, 39, 'S. Kabbaj', 'Avancement conforme.', $2, now() - interval '1 day', now())
     returning id`,
    [projectIds["CH-HO-014"], userIds["chef.oasis@jdc-digital.local"]]
  );
  const logId2 = logRows2[0].id;
  await query(
    `insert into daily_log_reviews (daily_log_id, reviewer_id, decision, comment) values ($1, $2, 'VALIDATED', null)`,
    [logId2, userIds["direction@jdc-digital.local"]]
  );
  const { rows: workRows2 } = await query(
    `insert into daily_log_works (daily_log_id, zone, description, quantity, unit, progress_pct, reference_rate) values
     ($1, 'Bloc B · RDC', 'Élévation murs porteurs', 30, 'm²', 60, 2.0)
     returning id`,
    [logId2]
  );
  // Rendement réel legerement sous la reference (30 m² / 16h = 1.875 vs 2.0
  // attendu) -- volontaire, pour montrer un écart négatif dans le rapport.
  await query(
    `insert into daily_log_attendances (daily_log_id, worker_id, work_id, date, hours) values
     ($1, $2, $3, current_date - interval '1 day', 8),
     ($1, $4, $3, current_date - interval '1 day', 8)`,
    [logId2, workerIds["OUV-005"], workRows2[0].id, workerIds["OUV-006"]]
  );

  return { userIds, projectIds };
}
