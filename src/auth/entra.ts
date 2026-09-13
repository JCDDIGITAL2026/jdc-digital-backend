// Integration Microsoft Entra ID (OIDC, authorization code + PKCE).
// Ce fichier n'a pas encore ete teste contre un vrai tenant TCGM -- il
// attend ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET (voir .env).
// Sans ces trois variables, buildEntraAuthUrl() echoue avec un message
// explicite plutot que de planter silencieusement.
import * as client from "openid-client";
import type { Request } from "express";
import { findUserByEntraObjectId, findUserByEmail, type AppUser } from "../db/repositories";

let configPromise: Promise<client.Configuration> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} manquant -- l'authentification Entra ID n'est pas encore configuree sur cet environnement.`
    );
  }
  return value;
}

async function getConfig(): Promise<client.Configuration> {
  if (!configPromise) {
    const tenantId = requireEnv("ENTRA_TENANT_ID");
    const clientId = requireEnv("ENTRA_CLIENT_ID");
    const clientSecret = requireEnv("ENTRA_CLIENT_SECRET");
    const issuer = new URL(
      `https://login.microsoftonline.com/${tenantId}/v2.0`
    );
    configPromise = client.discovery(issuer, clientId, clientSecret);
  }
  return configPromise;
}

// Stocke code_verifier + state le temps de l'aller-retour vers Microsoft.
// En un seul processus (increment 0) une Map en memoire suffit ; a
// remplacer par un stockage partage (Redis, ou table dediee) des que
// l'API tournera sur plusieurs instances.
const pendingLogins = new Map<
  string,
  { codeVerifier: string; createdAt: number }
>();

export async function buildEntraAuthUrl(): Promise<string> {
  const config = await getConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  pendingLogins.set(state, { codeVerifier, createdAt: Date.now() });

  const redirectUri = requireEnv("ENTRA_REDIRECT_URI");
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return url.toString();
}

export async function handleEntraCallback(req: Request): Promise<AppUser> {
  const config = await getConfig();
  const currentUrl = new URL(
    req.originalUrl,
    `${req.protocol}://${req.get("host")}`
  );
  const state = currentUrl.searchParams.get("state");
  const pending = state ? pendingLogins.get(state) : undefined;
  if (!pending) {
    throw new Error("Etat de connexion inconnu ou expire.");
  }
  pendingLogins.delete(state!);

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: state!,
  });
  const claims = tokens.claims();
  if (!claims || typeof claims.oid !== "string") {
    throw new Error("Jeton Entra ID sans identifiant d'objet (oid).");
  }

  // On rattache d'abord par oid (identifiant Entra stable), puis en
  // repli par email lors du tout premier login d'un compte deja cree
  // manuellement par un admin -- jamais de creation automatique de
  // compte ici : un utilisateur qui se connecte pour la premiere fois
  // doit deja exister (cree par un admin avec le bon role et les bons
  // chantiers), sans quoi l'authentification reussit mais l'acces reste
  // nul par defaut.
  const byOid = await findUserByEntraObjectId(claims.oid);
  if (byOid) return byOid;

  const email = typeof claims.email === "string" ? claims.email : undefined;
  if (email) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) return byEmail;
  }

  throw new Error(
    "Aucun compte actif ne correspond a cette identite Entra ID. Un administrateur doit d'abord creer le compte."
  );
}
