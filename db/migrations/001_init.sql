-- Increment 0 : identite, chantiers, droits, et le squelette du JDC
-- (equipes/travaux/incidents/pieces jointes repris de JDC Digital).
-- Le pointage nominatif et le rendement reel vs reference de Pilotis
-- arrivent en Increment 1+, une fois ce socle de droits valide.

create extension if not exists pgcrypto;

create type role as enum ('ADMIN', 'DIRECTION', 'CHEF_CHANTIER', 'LECTEUR');
create type project_status as enum ('ACTIF', 'SUSPENDU', 'CLOTURE');
create type daily_log_status as enum ('DRAFT', 'SUBMITTED', 'VALIDATED');
create type review_decision as enum ('VALIDATED', 'RETURNED');

-- Un utilisateur reel, authentifie via Entra ID en production
-- (entra_object_id rempli) ou via le mode dev local (entra_object_id nul).
create table users (
  id                text primary key default gen_random_uuid()::text,
  email             text not null unique,
  display_name      text not null,
  entra_object_id   text unique,
  role              role not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Un chantier ("project" au sens du handoff JDC Digital).
create table projects (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  code        text not null unique,
  location    text,
  status      project_status not null default 'ACTIF',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Affectation d'un utilisateur (typiquement un chef de chantier) a un chantier.
-- Un chef ne voit et ne peut ecrire que sur les chantiers ou il a une ligne ici --
-- c'est ce que le prototype JDC Digital ne faisait que dans l'interface,
-- jamais reellement impose.
create table project_members (
  id          text primary key default gen_random_uuid()::text,
  user_id     text not null references users(id) on delete cascade,
  project_id  text not null references projects(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, project_id)
);

-- Le journal de chantier journalier. Un seul par chantier et par date --
-- contrainte imposee par la base, pas seulement verifiee cote client.
create table daily_logs (
  id             text primary key default gen_random_uuid()::text,
  project_id     text not null references projects(id) on delete cascade,
  date           date not null,
  status         daily_log_status not null default 'DRAFT',
  weather        text,
  temp_min       integer,
  temp_max       integer,
  manager_name   text,
  observations   text,
  author_id      text not null references users(id),
  submitted_at   timestamptz,
  validated_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, date)
);

create table daily_log_teams (
  id            text primary key default gen_random_uuid()::text,
  daily_log_id  text not null references daily_logs(id) on delete cascade,
  company       text not null,
  trade         text not null,
  headcount     integer not null,
  hours         double precision not null
);

create table daily_log_works (
  id             text primary key default gen_random_uuid()::text,
  daily_log_id   text not null references daily_logs(id) on delete cascade,
  zone           text not null,
  description    text not null,
  quantity       double precision not null,
  unit           text not null,
  progress_pct   integer not null
);

create table daily_log_incidents (
  id             text primary key default gen_random_uuid()::text,
  daily_log_id   text not null references daily_logs(id) on delete cascade,
  type           text not null,
  severity       text not null,
  description    text not null,
  action         text,
  status         text not null
);

-- storage_key pointe vers l'objet dans le stockage prive (S3/Blob) --
-- jamais de blob stocke directement en base.
create table daily_log_attachments (
  id             text primary key default gen_random_uuid()::text,
  daily_log_id   text not null references daily_logs(id) on delete cascade,
  file_name      text not null,
  mime_type      text not null,
  size_bytes     integer not null,
  storage_key    text not null,
  created_at     timestamptz not null default now()
);

create table daily_log_reviews (
  id             text primary key default gen_random_uuid()::text,
  daily_log_id   text not null references daily_logs(id) on delete cascade,
  reviewer_id    text not null references users(id),
  decision       review_decision not null,
  comment        text,
  created_at     timestamptz not null default now()
);

-- Piste d'audit : une ligne par action sensible (creation, modification,
-- soumission, validation, renvoi, reouverture...). actor_id nul = action systeme.
create table audit_events (
  id            text primary key default gen_random_uuid()::text,
  actor_id      text references users(id),
  action        text not null,
  entity_type   text not null,
  entity_id     text not null,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index idx_daily_logs_project_date on daily_logs(project_id, date);
create index idx_project_members_user on project_members(user_id);
create index idx_audit_events_entity on audit_events(entity_type, entity_id);
