-- Increment 3 : registre nominatif des ouvriers, pointage journalier et
-- rendement reel vs reference (logique Pilotis, portee sur le socle
-- JDC Digital des increments precedents).
--
-- Hypothese assumee pour cet increment : un ouvrier n'a qu'une seule ligne
-- de pointage par jour (une tache ou aucune), pas un partage d'heures entre
-- plusieurs taches le meme jour -- coherent avec la contrainte metier deja
-- validee ("un ouvrier pointe devient indisponible pour tout autre
-- chantier ce jour-la"), etendue ici au niveau tache.

create type worker_nature as enum ('MOD', 'MOID');

-- Registre global des ouvriers -- pas rattache a un chantier : c'est
-- justement ce qui permet d'imposer, au niveau base, qu'un meme ouvrier ne
-- soit jamais pointe sur deux chantiers le meme jour (voir plus bas).
create table workers (
  id             text primary key default gen_random_uuid()::text,
  matricule      text unique,
  first_name     text not null,
  last_name      text not null,
  nature         worker_nature not null,
  qualification  text not null,
  active         boolean not null default true,
  entry_date     date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Rendement de reference (unites produites par heure) pour cette tache.
-- Absent = "reference non saisie" au rapport, comme dans Pilotis.
alter table daily_log_works add column reference_rate double precision;

-- Le pointage nominatif : qui a travaille, combien d'heures, sur quelle
-- tache (work_id nul = pointe sans tache assignee -- remonte en anomalie).
-- "date" duplique daily_logs.date pour porter la contrainte unique
-- (worker_id, date) : c'est elle qui empeche, au niveau base et non
-- seulement cote client, qu'un ouvrier soit pointe deux fois le meme jour,
-- y compris sur deux chantiers differents.
create table daily_log_attendances (
  id            text primary key default gen_random_uuid()::text,
  daily_log_id  text not null references daily_logs(id) on delete cascade,
  worker_id     text not null references workers(id),
  work_id       text references daily_log_works(id) on delete set null,
  date          date not null,
  hours         double precision not null,
  created_at    timestamptz not null default now(),
  unique (worker_id, date)
);

create index idx_daily_log_attendances_log on daily_log_attendances(daily_log_id);
create index idx_daily_log_attendances_worker on daily_log_attendances(worker_id);
