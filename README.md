# JDC Digital / Pilotis — backend, Incréments 0 à 5

Ce dossier est le backend réel décrit dans l'audit `CLAUDE_HANDOFF.md` :
identité, chantiers, droits imposés côté serveur, création/soumission d'un
brouillon de journal (incrément 1), sa validation ou son renvoi par
direction (incrément 2), le registre nominatif des ouvriers, le pointage
journalier et le rendement réel vs référence (incrément 3, logique
Pilotis), les pièces jointes (incrément 4), et — depuis l'incrément 5 —
une **console de test minimale** (`public/index.html`) servie par le
serveur lui-même, plus tout ce qu'il faut pour la rendre accessible en
ligne gratuitement (voir `DEPLOY.md`). L'export CSV/PDF des rapports
arrive dans un incrément suivant.

Aucune ressource payante n'est utilisée : tout tourne en local (PostgreSQL,
Node.js) dans cet environnement de développement. `DEPLOY.md` explique
comment obtenir une vraie URL testable sans payer (Neon + Render, plans
gratuits) — nécessaire pour tester autrement qu'en local, puisqu'un
navigateur ne peut pas atteindre ce qui tourne uniquement ici.

## Ce qui existe à ce stade

- Modèle de données (`db/migrations/001_init.sql`) : utilisateurs, rôles,
  chantiers, affectations, journaux journaliers et leurs sous-tables
  (équipes, travaux, incidents, pièces jointes, validations), piste d'audit.
- Authentification :
  - **mode dev** (`AUTH_MODE=dev`) : connexion par email parmi les comptes
    seedés, pour travailler sans dépendre d'un tenant Entra ID.
  - **Microsoft Entra ID** (`src/auth/entra.ts`) : flux OIDC complet
    (authorization code + PKCE) prêt à être branché dès que
    `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` sont
    renseignés. **Non encore testé contre un vrai tenant.**
- Droits imposés serveur : un chef de chantier ne reçoit et ne peut écrire,
  à aucun moment, sur un chantier ou un journal qui n'est pas le sien —
  vérifié par les tests automatiques, pas seulement par l'interface (c'est
  le point que le prototype JDC Digital ne faisait pas).
- Lecture : `GET /api/projects`, `GET /api/projects/:id`,
  `GET /api/daily-logs`, `GET /api/daily-logs/:id`.
- Écriture (incrément 1) :
  - `POST /api/daily-logs` — crée un brouillon (statut `DRAFT`) pour un
    chantier et une date ; refusé (409) si un journal existe déjà pour ce
    couple chantier/date (contrainte imposée par la base, pas seulement
    vérifiée côté client).
  - `PATCH /api/daily-logs/:id` — modifie un brouillon (remplace en bloc
    équipes/travaux/incidents) ; refusé (409) dès que le journal n'est plus
    `DRAFT`.
  - `POST /api/daily-logs/:id/submit` — fait passer un brouillon à
    `SUBMITTED` ; refusé (409) s'il ne l'est déjà plus (pas de resoumission).
  - Ces trois routes sont fermées au rôle `LECTEUR` (403) et, pour un chef
    de chantier, à tout chantier où il n'est pas affecté (403).
- Validation (incrément 2) :
  - `POST /api/daily-logs/:id/review` — `{ decision: "VALIDATED" | "RETURNED", comment? }`.
    Réservé à `DIRECTION`/`ADMIN` (403 pour un chef de chantier, même sur
    son propre journal — c'est le sens du workflow) ; refusé (409) si le
    journal n'est pas au statut `SUBMITTED` (pas de validation directe d'un
    brouillon, pas de revalidation d'un journal déjà validé).
    - `VALIDATED` fige le journal (`status=VALIDATED`, `validated_at`).
    - `RETURNED` exige un commentaire (400 sinon) et remet le journal en
      `DRAFT` (`submitted_at` effacé) : le chef de chantier peut alors le
      corriger et le resoumettre normalement.
  - Chaque validation/renvoi ajoute une ligne dans `daily_log_reviews`
    (l'historique des allers-retours reste visible dans le détail du
    journal) et un évènement dans `audit_events`.
- Registre ouvriers et pointage nominatif (incrément 3, `db/migrations/002_worker_attendance.sql`) :
  - `GET /api/workers` — registre complet (matricule, nom, nature
    MOD/MOID, qualification), lecture ouverte à tout utilisateur
    authentifié (un chef en a besoin pour composer son pointage).
  - `POST /api/workers` / `PATCH /api/workers/:id` — réservés à
    `DIRECTION`/`ADMIN`. La nature MOD/MOID est déduite automatiquement de
    la qualification quand elle n'est pas fournie (mêmes mots-clés que sur
    Pilotis : chef, conducteur, grutier, magasinier, gardien, encadrement,
    pointeur, chauffeur → MOID, sinon MOD), modifiable ensuite.
  - `POST /api/daily-logs` et `PATCH /api/daily-logs/:id` acceptent
    désormais un tableau `attendances: [{ workerId, hours, workIndex? }]`
    (remplacé en bloc comme `teams`/`works`/`incidents` ; `workIndex`
    référence une tâche du tableau `works` envoyé dans la même requête,
    absent = ouvrier pointé sans tâche assignée).
  - **Un ouvrier ne peut être pointé qu'une fois par jour, tous chantiers
    confondus** — contrainte unique `(worker_id, date)` imposée par la
    base (`daily_log_attendances`), pas seulement vérifiée côté client :
    refusé en 409 avec le nom du chantier concerné, comme le faisait déjà
    l'interface Pilotis.
  - `GET /api/daily-logs/:id` renvoie, en plus des champs existants, pour
    chaque tâche (`works[]`) la liste nominative des ouvriers affectés, les
    heures totales pointées dessus, le rendement réel (quantité / heures)
    et l'écart en % vs `referenceRate` (absent = "référence non saisie") ;
    au niveau du journal, le pointage complet (`pointage[]`, avec heures
    supplémentaires au-delà de 8h/jour), les heures par qualification
    (`heuresParQualification`), et deux anomalies (`anomalies.modSansTache`
    — main-d'œuvre directe pointée sans tâche — et
    `anomalies.tacheSansPointage`).
- Pièces jointes (incrément 4, `db/migrations/002_worker_attendance.sql`
  ne change pas — les tables existaient déjà depuis l'incrément 0) :
  - `POST /api/daily-logs/:id/attachments` — upload multipart (champ
    `file`), réservé à un journal encore `DRAFT` et accessible par
    l'utilisateur (mêmes règles que les autres écritures). JPEG/PNG/WEBP/PDF
    uniquement, 10 Mo max par fichier (400 sinon).
  - `DELETE /api/daily-logs/:id/attachments/:attachmentId` — retire une
    pièce jointe d'un brouillon (fichier + ligne en base).
  - Le fichier est écrit sur un **stockage local** (`ATTACHMENTS_DIR`,
    zéro coût dans cet environnement de développement — voir
    `src/storage/fileStorage.ts`) sous une clé opaque (UUID) ; jamais de
    blob dans la base, jamais la clé de stockage exposée dans les réponses
    JSON, conformément au modèle de données prévu dès l'incrément 0.
  - `GET /api/daily-logs/:id` renvoie, pour chaque pièce jointe, un
    `downloadUrl` **signé** (HMAC, `src/storage/signedUrl.ts`), valable 15
    minutes, régénéré à chaque lecture — le même principe qu'une URL
    présignée S3/Blob : quiconque a le lien peut télécharger jusqu'à
    expiration, sans avoir besoin d'une session. C'est pour ça que la route
    de téléchargement (`GET /attachments/:id/download`) est volontairement
    hors de `/api` et hors authentification par cookie ; toute l'autorisation
    tient dans la signature du lien, qui n'est distribuée qu'après
    vérification normale des droits sur le journal.
- Console de test et déploiement (incrément 5) :
  - `public/index.html` — page unique (HTML/CSS/JS, sans dépendance externe)
    servie par le serveur lui-même à la racine (`GET /`, même origine que
    l'API, donc pas de souci de cookies/CORS) : connexion (mode dev),
    liste des chantiers et journaux, détail d'un journal (rendement,
    pointage, anomalies, pièces jointes), création d'un brouillon,
    soumission, validation/renvoi, registre ouvriers. Pas soignée
    visuellement (ce n'est pas l'interface finale) mais fonctionnelle —
    vérifiée à la fois par un script Playwright et manuellement.
  - `DATABASE_SSL` (+ `DATABASE_SSL_REJECT_UNAUTHORIZED`) — active TLS sur
    la connexion PostgreSQL (`src/db/sslConfig.ts`), nécessaire pour Neon
    et la plupart des Postgres gratuits managés ; sans effet en local.
  - `RUN_MIGRATIONS_ON_BOOT=true` — applique les migrations au démarrage du
    serveur plutôt qu'en CLI séparée, pour un hébergement gratuit sans accès
    shell après déploiement (Render free tier).
  - `POST /admin/seed` (header `x-admin-token`) — repeuple les données de
    démonstration à distance, pour la même raison. Désactivée par défaut
    (404) tant que `ADMIN_SEED_TOKEN` n'est pas défini ; ne doit **jamais**
    être activée sur un environnement contenant de vraies données (elle
    vide les tables avant de les repeupler).
  - `DEPLOY.md` — guide pas à pas pour déployer gratuitement sur Neon
    (base de données) + Render (serveur) et obtenir une URL testable.

## Ce qui n'existe PAS encore (incréments suivants)

- Export CSV / PDF des rapports.
- Un vrai stockage objet (S3/Blob) en remplacement du stockage local de
  l'incrément 4 — le code est déjà structuré pour ce remplacement
  (`src/storage/fileStorage.ts` est le seul fichier à changer), mais tant
  que le budget d'hébergement reste à zéro, aucune ressource payante n'a
  été provisionnée.
- Révocation de session côté serveur : `/auth/logout` efface le cookie
  mais le jeton JWT reste valide jusqu'à son expiration (12h) s'il était
  rejoué manuellement. À corriger avant la mise en production (session
  stockée en base, invalidable).
- Simplification assumée (incrément 3) : un ouvrier n'a qu'une seule ligne
  de pointage par jour (une tâche, ou aucune) — pas de partage d'heures
  entre plusieurs tâches le même jour. Cohérent avec la règle déjà validée
  sur Pilotis ("un ouvrier pointé devient indisponible pour tout autre
  chantier ce jour-là"), étendue ici au niveau tâche plutôt que chantier.
  À revoir si un cas réel demande de scinder les heures d'un même ouvrier
  entre deux tâches le même jour.
- Le seuil "heures supplémentaires" (8h/jour) est fixe dans le code pour
  cet incrément, pas configurable par chantier ou par convention.
- Simplification assumée (incrément 4) : le stockage local des pièces
  jointes n'est pas répliqué/sauvegardé — acceptable en développement, à
  remplacer par un vrai stockage objet avant toute donnée réelle de
  production.

## Lancer en local

```bash
npm install
npm run migrate     # applique db/migrations/*.sql sur DATABASE_URL (.env)
npm run seed        # jeu de données de démonstration + comptes de dev
npm run dev         # démarre l'API sur http://localhost:3000
```

Ouvrir `http://localhost:3000/` dans un navigateur affiche directement la
console de test (`public/index.html`) — pratique en local, mais pour la
partager il faut la déployer (voir `DEPLOY.md`), un navigateur externe ne
pouvant pas atteindre `localhost` de cette machine.

Se connecter en mode dev :

```bash
curl -c cookies.jar -X POST http://localhost:3000/auth/dev/login \
  -H "Content-Type: application/json" \
  -d '{"email":"chef.atlas@jdc-digital.local"}'

curl -b cookies.jar http://localhost:3000/api/projects
```

Créer puis soumettre un brouillon (avec la session `chef.atlas` ci-dessus) :

```bash
curl -b cookies.jar -X POST http://localhost:3000/api/daily-logs \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<id du chantier>","date":"2026-12-01",
       "teams":[{"company":"Entreprise pilote","trade":"Coffrage","headcount":5,"hours":8}],
       "works":[], "incidents":[]}'

curl -b cookies.jar -X POST http://localhost:3000/api/daily-logs/<id du journal>/submit
```

Valider ou renvoyer (avec une session `direction`) :

```bash
curl -c direction.jar -X POST http://localhost:3000/auth/dev/login \
  -H "Content-Type: application/json" -d '{"email":"direction@jdc-digital.local"}'

curl -b direction.jar -X POST http://localhost:3000/api/daily-logs/<id du journal>/review \
  -H "Content-Type: application/json" -d '{"decision":"VALIDATED"}'

curl -b direction.jar -X POST http://localhost:3000/api/daily-logs/<id du journal>/review \
  -H "Content-Type: application/json" \
  -d '{"decision":"RETURNED","comment":"Heures manquantes sur l'\''equipe ferraillage"}'
```

Consulter le registre puis pointer des ouvriers sur un brouillon :

```bash
curl -b cookies.jar http://localhost:3000/api/workers

curl -b cookies.jar -X POST http://localhost:3000/api/daily-logs \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<id du chantier>","date":"2026-12-01",
       "teams":[], "incidents":[],
       "works":[{"zone":"Bloc A","description":"Coffrage","quantity":42,"unit":"m²","progressPct":80,"referenceRate":2.5}],
       "attendances":[{"workerId":"<id ouvrier 1>","hours":8,"workIndex":0},
                       {"workerId":"<id ouvrier 2>","hours":8,"workIndex":0}]}'
```

Ajouter une pièce jointe à un brouillon puis la télécharger :

```bash
curl -b cookies.jar -X POST http://localhost:3000/api/daily-logs/<id du journal>/attachments \
  -F "file=@photo-chantier.jpg;type=image/jpeg"

# La reponse (ou un GET /api/daily-logs/<id>) contient attachments[].downloadUrl,
# un lien signe et directement telechargeable, sans cookie :
curl -o photo.jpg "http://localhost:3000/attachments/<id piece jointe>/download?exp=...&sig=..."
```

Comptes de démonstration (voir `db/seed.ts`) : `admin@jdc-digital.local`,
`direction@jdc-digital.local`, `chef.atlas@jdc-digital.local`,
`chef.oasis@jdc-digital.local`, `lecteur@jdc-digital.local`.

## Tests automatiques

```bash
npm test
```

Exécute la suite contre une base séparée (`.env.test`, base `jdc_test`),
reseedée avant chaque test. Couvre : refus sans session, refus d'un email
inconnu, cloisonnement par chantier pour un chef de chantier (liste et
détail), visibilité complète pour direction/lecteur/admin, fermeture de la
route de login dev hors `AUTH_MODE=dev`, création/modification/soumission
d'un brouillon par son chef de chantier, refus (403) pour un lecteur ou pour
un chantier qui n'est pas le sien, refus (409) d'un doublon chantier/date et
d'une modification ou resoumission d'un journal déjà soumis, validation et
renvoi (avec commentaire obligatoire) d'un journal soumis par direction,
refus (403) pour un chef de chantier ou un lecteur qui tenterait de valider,
refus (409) de valider un brouillon ou de revalider un journal déjà validé,
calcul du rendement réel et de l'écart vs référence, détection des
anomalies MOD-sans-tâche, heures supplémentaires, refus (409) de pointer un
ouvrier déjà engagé ce jour-là sur un autre chantier, refus (400) d'un
`workIndex` hors bornes, gestion du registre ouvriers (création réservée à
direction/admin, nature déduite automatiquement, lecture ouverte à tous),
upload et téléchargement d'une pièce jointe via son lien signé, refus
(403) d'un lien expiré ou falsifié, refus (400) d'un type de fichier non
supporté ou d'un fichier trop volumineux, refus (403) pour un lecteur ou
pour un chantier qui n'est pas le sien, refus (409) sur un journal déjà
soumis, suppression d'une pièce jointe (le lien précédent cesse de
fonctionner).

## Variables d'environnement (`.env`)

Voir `.env` (dev) et `.env.test` (tests). `DATABASE_URL`, `DATABASE_SSL`
(+ `DATABASE_SSL_REJECT_UNAUTHORIZED`, pour Neon/Render — voir `DEPLOY.md`),
`AUTH_MODE` (`dev` ou `entra`), `SESSION_SECRET` (sert aussi à signer les
liens de téléchargement des pièces jointes), `ATTACHMENTS_DIR` (dossier de
stockage local des pièces jointes, séparé entre dev et tests),
`RUN_MIGRATIONS_ON_BOOT` et `ADMIN_SEED_TOKEN` (hébergement sans accès
shell), et les `ENTRA_*` pour la bascule vers Microsoft Entra ID.
