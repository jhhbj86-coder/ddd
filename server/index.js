import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8080);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const uploadDir = path.join(dataDir, "uploads");
const dbPath = path.join(dataDir, "memories.json");
const password = process.env.COUPLE_SITE_PASSWORD || "159951";
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const prod = process.env.NODE_ENV === "production";
const maxMb = Number(process.env.MAX_UPLOAD_MB || 12);

await fs.mkdir(uploadDir, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif" }[file.mimetype] || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(file.mimetype?.startsWith("image/") ? null : new Error("只能上传图片。"), true)
});

async function readDb() {
  try {
    return JSON.parse(await fs.readFile(dbPath, "utf8"));
  } catch {
    return { memories: [] };
  }
}

async function writeDb(db) {
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = `${dbPath}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, dbPath);
}

let queue = Promise.resolve();
function updateDb(fn) {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function text(v, n = 500) {
  return String(v ?? "").trim().slice(0, n);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token?.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (Buffer.byteLength(sig || "") !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp > Date.now() ? payload : null;
}

function cookie(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").filter(Boolean).map((v) => {
    const i = v.indexOf("=");
    return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
  }));
}

function user(req) {
  const auth = req.headers.authorization || "";
  return verify(auth.startsWith("Bearer ") ? auth.slice(7) : cookie(req).couple_session);
}

function needUser(req, res, next) {
  if (!user(req)) return res.status(401).json({ error: "请先输入专属密码。" });
  next();
}

function publicView(m) {
  return { ...m, reactions: [], reminder: null };
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/session", (req, res) => res.json({ authenticated: Boolean(user(req)), maxUploadMb: maxMb }));

app.post("/api/auth/login", (req, res) => {
  const ok = crypto.timingSafeEqual(crypto.createHash("sha256").update(text(req.body.password, 200)).digest(), crypto.createHash("sha256").update(password).digest());
  if (!ok) return res.status(401).json({ error: "密码不对。" });
  const token = sign({ exp: Date.now() + 30 * 864e5 });
  res.cookie("couple_session", token, { httpOnly: true, sameSite: "lax", secure: prod, maxAge: 30 * 864e5 });
  res.json({ token });
});

app.post("/api/auth/logout", (_req, res) => {
  res.cookie("couple_session", "", { httpOnly: true, sameSite: "lax", secure: prod, maxAge: 0 });
  res.json({ ok: true });
});

app.get("/api/memories", async (req, res) => {
  const db = await readDb();
  const authed = Boolean(user(req));
  const memories = db.memories
    .filter((m) => authed || m.visibility === "public")
    .map((m) => (authed ? m : publicView(m)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ memories });
});

app.post("/api/memories", needUser, upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请选择照片。" });
  const now = new Date().toISOString();
  const memory = {
    id: crypto.randomUUID(),
    title: text(req.body.title, 80),
    date: text(req.body.date, 40) || now.slice(0, 10),
    note: text(req.body.note, 1200),
    visibility: req.body.visibility === "public" ? "public" : "private",
    image: { url: `/uploads/${req.file.filename}`, filename: req.file.filename },
    reminder: req.body.reminderEnabled === "true" && req.body.remindAt ? { enabled: true, remindAt: text(req.body.remindAt, 40), text: text(req.body.reminderText, 240), doneAt: "" } : null,
    reactions: [],
    createdAt: now,
    updatedAt: now
  };
  await updateDb((db) => db.memories.unshift(memory));
  res.status(201).json({ memory });
});

app.patch("/api/memories/:id", needUser, async (req, res) => {
  const memory = await updateDb((db) => {
    const m = db.memories.find((x) => x.id === req.params.id);
    if (!m) return null;
    if ("visibility" in req.body) m.visibility = req.body.visibility === "public" ? "public" : "private";
    m.updatedAt = new Date().toISOString();
    return m;
  });
  memory ? res.json({ memory }) : res.status(404).json({ error: "没找到。" });
});

app.post("/api/memories/:id/reactions", needUser, async (req, res) => {
  const reaction = { id: crypto.randomUUID(), author: text(req.body.author, 16) || "TA", mood: text(req.body.mood, 24), text: text(req.body.text, 280), createdAt: new Date().toISOString() };
  const memory = await updateDb((db) => {
    const m = db.memories.find((x) => x.id === req.params.id);
    if (!m) return null;
    m.reactions.push(reaction);
    return m;
  });
  memory ? res.status(201).json({ memory }) : res.status(404).json({ error: "没找到。" });
});

app.patch("/api/memories/:id/reminder/done", needUser, async (req, res) => {
  const memory = await updateDb((db) => {
    const m = db.memories.find((x) => x.id === req.params.id);
    if (!m?.reminder) return null;
    m.reminder.doneAt = new Date().toISOString();
    return m;
  });
  memory ? res.json({ memory }) : res.status(404).json({ error: "没找到提醒。" });
});

app.delete("/api/memories/:id", needUser, async (req, res) => {
  const old = await updateDb((db) => {
    const i = db.memories.findIndex((x) => x.id === req.params.id);
    return i >= 0 ? db.memories.splice(i, 1)[0] : null;
  });
  if (old?.image?.filename) await fs.unlink(path.join(uploadDir, path.basename(old.image.filename))).catch(() => {});
  res.json({ ok: true });
});

app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(root, "public")));
app.use((_req, res) => res.sendFile(path.join(root, "public", "index.html")));
app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || "请求失败。" }));

app.listen(port, () => console.log(`Couple memory site listening on http://127.0.0.1:${port}`));
