import type { Request, Response, NextFunction } from "express";
import { readSessionUserId } from "../auth/session";
import { findUserById, type AppUser } from "../db/repositories";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AppUser;
    }
  }
}

// Verifie la session et charge l'utilisateur REEL depuis la base a chaque
// requete -- jamais de role ou d'id de chantier fait confiance depuis le
// client (c'est exactement le trou de securite du prototype JDC Digital).
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userId = readSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentification requise." });
    return;
  }
  const user = await findUserById(userId);
  if (!user) {
    res.status(401).json({ error: "Session invalide ou compte desactive." });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(...roles: AppUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentification requise." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Acces refuse pour ce role." });
      return;
    }
    next();
  };
}
