import jwt from "jsonwebtoken";
import type { Request, Response } from "express";

const COOKIE_NAME = "session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET manquant (voir .env)");
  return s;
}

export function issueSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, secret(), { expiresIn: "12h" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // secure: true en production (HTTPS) -- desactive en dev local http.
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

export function readSessionUserId(req: Request): string | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret()) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}
