import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const uploadDir = path.join(dataDir, "uploads");
const dbPath = path.join(dataDir, "db.json");
const adminPassword = process.env.ADMIN_PASSWORD || "admin1234";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("이미지 파일만 업로드할 수 있습니다."));
  }
});

async function ensureDb() {
  await fs.mkdir(uploadDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    await saveDb({ participants: [], rankings: [] });
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

function makeId() {
  return crypto.randomUUID();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

function requireAdmin(req, res, next) {
  if (req.header("x-admin-password") !== adminPassword) {
    return res.status(401).json({ message: "관리자 비밀번호가 올바르지 않습니다." });
  }
  next();
}

function publicParticipant(participant, includeSecret = false) {
  const base = {
    id: participant.id,
    name: participant.name,
    mission: participant.mission,
    hasPassword: Boolean(participant.passwordHash),
    guessId: participant.guessId || "",
    photo: participant.photo || null,
    createdAt: participant.createdAt
  };
  return base;
}

app.get("/api/participants", async (_req, res) => {
  const db = await readDb();
  res.json(db.participants.map((p) => ({
    id: p.id,
    name: p.name,
    hasPassword: Boolean(p.passwordHash)
  })));
});

app.post("/api/login", async (req, res) => {
  const { participantId, password, newPassword } = req.body;
  const db = await readDb();
  const participant = db.participants.find((p) => p.id === participantId);
  if (!participant) return res.status(404).json({ message: "참가자를 찾을 수 없습니다." });

  if (!participant.passwordHash) {
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ message: "새 비밀번호는 4자 이상이어야 합니다." });
    }
    participant.passwordHash = hashPassword(newPassword);
    await saveDb(db);
  } else if (!verifyPassword(password || "", participant.passwordHash)) {
    return res.status(401).json({ message: "비밀번호가 올바르지 않습니다." });
  }

  res.json({
    participant: publicParticipant(participant),
    participants: db.participants.map((p) => ({ id: p.id, name: p.name }))
  });
});

app.get("/api/me/:id", async (req, res) => {
  const db = await readDb();
  const participant = db.participants.find((p) => p.id === req.params.id);
  if (!participant) return res.status(404).json({ message: "참가자를 찾을 수 없습니다." });
  res.json({ participant: publicParticipant(participant) });
});

app.post("/api/guess", async (req, res) => {
  const { participantId, guessId } = req.body;
  const db = await readDb();
  const participant = db.participants.find((p) => p.id === participantId);
  if (!participant) return res.status(404).json({ message: "참가자를 찾을 수 없습니다." });
  participant.guessId = guessId || "";
  await saveDb(db);
  res.json({ participant: publicParticipant(participant) });
});

app.post("/api/upload", upload.single("photo"), async (req, res) => {
  const { participantId } = req.body;
  const db = await readDb();
  const participant = db.participants.find((p) => p.id === participantId);
  if (!participant) return res.status(404).json({ message: "참가자를 찾을 수 없습니다." });
  if (!req.file) return res.status(400).json({ message: "사진 파일을 선택해 주세요." });

  if (participant.photo?.filename) {
    await fs.unlink(path.join(uploadDir, participant.photo.filename)).catch(() => {});
  }
  participant.photo = {
    filename: req.file.filename,
    url: `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  await saveDb(db);
  res.json({ participant: publicParticipant(participant) });
});

app.get("/api/admin/state", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json({
    participants: db.participants.map((p) => publicParticipant(p, true)),
    rankings: db.rankings || []
  });
});

app.post("/api/admin/participants", requireAdmin, async (req, res) => {
  const { name, mission } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "참가자 이름을 입력해 주세요." });
  const db = await readDb();
  const participant = {
    id: makeId(),
    name: name.trim(),
    mission: mission?.trim() || "마니또가 눈치채지 못하게 자연스러운 사진 찍기",
    guessId: "",
    passwordHash: "",
    photo: null,
    createdAt: new Date().toISOString()
  };
  db.participants.push(participant);
  await saveDb(db);
  res.json({ participant: publicParticipant(participant, true) });
});

app.put("/api/admin/participants/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const participant = db.participants.find((p) => p.id === req.params.id);
  if (!participant) return res.status(404).json({ message: "참가자를 찾을 수 없습니다." });
  participant.name = req.body.name?.trim() || participant.name;
  participant.mission = req.body.mission?.trim() || participant.mission;
  await saveDb(db);
  res.json({ participant: publicParticipant(participant, true) });
});

app.delete("/api/admin/participants/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const index = db.participants.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: "참가자를 찾을 수 없습니다." });
  const [removed] = db.participants.splice(index, 1);
  if (removed.photo?.filename) {
    await fs.unlink(path.join(uploadDir, removed.photo.filename)).catch(() => {});
  }
  db.participants.forEach((p) => {
    if (p.guessId === removed.id) p.guessId = "";
  });
  db.rankings = (db.rankings || []).map((r) => ({
    ...r,
    participantId: r.participantId === removed.id ? "" : r.participantId
  }));
  await saveDb(db);
  res.json({ ok: true });
});

app.post("/api/admin/reset-password/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const participant = db.participants.find((p) => p.id === req.params.id);
  if (!participant) return res.status(404).json({ message: "참가자를 찾을 수 없습니다." });
  participant.passwordHash = "";
  await saveDb(db);
  res.json({ ok: true });
});

app.post("/api/admin/rankings", requireAdmin, async (req, res) => {
  const ids = [req.body.first, req.body.second, req.body.third];
  const db = await readDb();
  db.rankings = [1, 2, 3].map((rank, index) => ({
    rank,
    participantId: ids[index] || ""
  }));
  await saveDb(db);
  res.json({ rankings: db.rankings });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ message: err.message || "요청을 처리할 수 없습니다." });
});

const port = Number(process.env.PORT || 3000);
await ensureDb();
app.listen(port, () => {
  console.log(`Paparazzi Manito app running at http://localhost:${port}`);
});
