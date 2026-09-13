import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth";
import { projectsRouter } from "./routes/projects";
import { dailyLogsRouter } from "./routes/dailyLogs";
import { workersRouter } from "./routes/workers";
import { attachmentsRouter } from "./routes/attachments";
import { adminRouter } from "./routes/admin";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/daily-logs", dailyLogsRouter);
  app.use("/api/workers", workersRouter);
  app.use("/admin", adminRouter);

  // Hors /api et hors requireAuth par conception -- voir le commentaire en
  // tete de routes/attachments.ts (autorisation portee par la signature du
  // lien, pas par un cookie de session).
  app.use("/attachments", attachmentsRouter);

  // Console de test minimale (public/index.html), servie en meme temps que
  // l'API -- meme origine, donc pas de souci CORS/cookies pour un test
  // rapide depuis un navigateur. A remplacer par la vraie interface le
  // moment venu ; ne contient aucune donnee, juste du HTML/JS statique.
  // process.cwd() plutot que __dirname : la profondeur de __dirname change
  // entre dev (src/) et prod compilee (dist/src/), pas process.cwd() (les
  // scripts npm dev/build/start sont tous lances depuis la racine du projet).
  app.use(express.static(path.join(process.cwd(), "public")));

  return app;
}
