# Déployer gratuitement pour tester (Neon + Render)

Ce guide met le backend et sa console de test en ligne, accessibles depuis
n'importe quel navigateur, **sans dépense** — deux comptes gratuits
(Neon pour la base de données, Render pour le serveur). C'est un
environnement de **test/démonstration**, pas de production : les données y
sont fictives, le stockage des pièces jointes n'est pas durable sur le
plan gratuit de Render (voir la limite en bas de ce document).

Je ne peux pas créer ces comptes à ta place (Claude ne crée jamais de
compte ni ne saisit de mot de passe pour toi) — chaque étape ci-dessous où
c'est le cas est marquée **👤 à faire toi-même**. Le reste (fichiers de
config, code) est déjà prêt dans ce projet.

## Étape 1 — Base de données (Neon, gratuit)

**👤 À faire toi-même :**
1. Va sur [neon.tech](https://neon.tech), crée un compte gratuit.
2. Crée un projet (nom libre, ex. "jdc-digital-test").
3. Dans le tableau de bord du projet, onglet **Connection string** (ou
   "Connect"), copie l'URL de connexion — elle ressemble à :
   `postgresql://<user>:<password>@<host>.neon.tech/<database>?sslmode=require`
4. Garde cette URL de côté, elle sert à l'étape 3.

## Étape 2 — Mettre le code sur GitHub

Render déploie à partir d'un dépôt Git. Si tu n'as pas encore mis ce
projet sur GitHub :

**👤 À faire toi-même (sans ligne de commande) :**
1. Va sur [github.com](https://github.com), crée un compte gratuit si besoin.
2. Crée un nouveau dépôt (bouton **New**), nom libre (ex. `jdc-digital-backend`),
   laisse-le **vide** (pas de README auto-généré).
3. Sur la page du dépôt vide, clique **uploading an existing file**.
4. Dézippe le fichier que je t'ai envoyé (`jdc-digital-backend-increment*.zip`)
   sur ton ordinateur, puis glisse-dépose **le contenu du dossier**
   `jdc-digital-backend/` (pas le dossier lui-même) dans la zone d'upload
   de GitHub. `node_modules/`, `dist/`, `.env*` n'y sont pas — c'est normal,
   ils sont exclus exprès (voir `.gitignore`).
5. Valide ("Commit changes").

## Étape 3 — Serveur (Render, gratuit)

**👤 À faire toi-même :**
1. Va sur [render.com](https://render.com), crée un compte gratuit
   (tu peux te connecter directement avec ton compte GitHub).
2. **New +** → **Web Service**, connecte le dépôt créé à l'étape 2.
3. Renseigne :
   - **Build Command** : `npm install && npm run build`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
4. Dans **Environment Variables**, ajoute :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | l'URL Neon copiée à l'étape 1 |
   | `DATABASE_SSL` | `true` |
   | `AUTH_MODE` | `dev` |
   | `SESSION_SECRET` | une phrase aléatoire de ton choix (ex. `un-secret-different-de-la-prod-123`) |
   | `RUN_MIGRATIONS_ON_BOOT` | `true` |
   | `ADMIN_SEED_TOKEN` | un mot de passe de ton choix (sert à peupler les données de démo, étape 4) |

   Laisse `PORT` non défini — Render le fournit automatiquement.
5. Clique **Create Web Service**. Le premier déploiement prend quelques
   minutes ; suis les logs dans l'onglet **Logs**. À la fin tu dois voir
   `JDC Digital backend sur http://localhost:...` et les migrations
   appliquées.
6. Ton URL publique apparaît en haut de la page (`https://<nom>.onrender.com`).

## Étape 4 — Peupler les données de démonstration

Une seule fois, après le premier déploiement (le plan gratuit de Render
n'offre pas d'accès shell pour lancer `npm run seed` à la main, d'où cette
route dédiée) :

**👤 À faire toi-même**, avec `curl` (invite de commande) ou un simple
navigateur avec une extension REST — ou dis-le-moi et je le déclenche moi-même
dès que tu m'auras donné l'URL Render et le `ADMIN_SEED_TOKEN` choisi :

```bash
curl -X POST https://<nom>.onrender.com/admin/seed -H "x-admin-token: <ton ADMIN_SEED_TOKEN>"
```

Une réponse `{"ok":true,"seededAccounts":[...]}` confirme que les comptes
et chantiers de démo sont prêts.

## Étape 5 — Tester

Ouvre `https://<nom>.onrender.com/` dans ton navigateur : c'est la console
de test (`public/index.html`), servie directement par le serveur. Connecte-toi
avec un des comptes de démo (menu déroulant, mode dev, pas de mot de passe)
et navigue : chantiers, journaux, rendement, pointage, validation, pièces
jointes, registre ouvriers.

## Limites de cet environnement de test (à connaître avant d'y montrer quoi que ce soit à un tiers)

- **Plan gratuit Render** : le service se met en veille après ~15 minutes
  d'inactivité et redémarre (30-60 secondes) au prochain appel — normal,
  pas une panne.
- **Stockage des pièces jointes non durable** : le disque du plan gratuit
  Render n'est pas persistant entre redéploiements/redémarrages — les
  photos uploadées peuvent disparaître. Sans impact pour un test fonctionnel,
  à corriger (vrai stockage objet) avant toute donnée réelle.
- **`ADMIN_SEED_TOKEN`** réinitialise toutes les données à chaque appel
  (`seedDatabase` vide puis repeuple les tables) — pratique pour repartir
  propre pendant les tests, dangereux si jamais activé sur un environnement
  contenant de vraies données. Ne jamais le définir en production.
- Toutes les autres limites déjà documentées dans `README.md` restent
  valables (pas de révocation de session, Entra ID non testé, etc.).
