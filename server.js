const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-in-production";
const DB_PATH = path.join(__dirname, "chat.db");
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDb() {
  await run("PRAGMA foreign_keys = ON;");
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      about TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      message_type TEXT NOT NULL CHECK(message_type IN ('text', 'image', 'video')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(recipient_id) REFERENCES users(id)
    );
  `);
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    about: row.about
  };
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || "").toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image or video files are allowed"));
  }
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/auth/register", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const displayName = String(req.body.displayName || "").trim();
  const about = String(req.body.about || "").trim();

  if (!username || !password || !displayName) {
    res.status(400).json({ error: "Username, password, and display name are required" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      `
      INSERT INTO users (username, password_hash, display_name, about)
      VALUES (?, ?, ?, ?);
      `,
      [username, hash, displayName, about]
    );

    const user = await get("SELECT id, username, display_name, about FROM users WHERE id = ?;", [
      result.lastID
    ]);
    const token = signToken(user.id);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE constraint failed")) {
      res.status(409).json({ error: "Username already exists" });
      return;
    }
    res.status(500).json({ error: "Could not create account" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  try {
    const userWithPassword = await get(
      "SELECT id, username, display_name, about, password_hash FROM users WHERE username = ?;",
      [username]
    );

    if (!userWithPassword) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, userWithPassword.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = signToken(userWithPassword.id);
    res.json({
      token,
      user: {
        id: userWithPassword.id,
        username: userWithPassword.username,
        displayName: userWithPassword.display_name,
        about: userWithPassword.about
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Could not log in" });
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await get("SELECT id, username, display_name, about FROM users WHERE id = ?;", [
      req.userId
    ]);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Could not fetch user" });
  }
});

app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    const users = await all(
      "SELECT id, username, display_name, about FROM users WHERE id != ? ORDER BY display_name ASC;",
      [req.userId]
    );
    res.json({ users: users.map(toPublicUser) });
  } catch (err) {
    res.status(500).json({ error: "Could not fetch users" });
  }
});

async function createAndBroadcastMessage({ senderId, recipientId, type, content }) {
  const insertResult = await run(
    `
    INSERT INTO messages (sender_id, recipient_id, message_type, content)
    VALUES (?, ?, ?, ?);
    `,
    [senderId, recipientId, type, content]
  );

  const message = await get(
    `
    SELECT
      id,
      sender_id AS senderId,
      recipient_id AS recipientId,
      message_type AS type,
      content,
      created_at AS createdAt
    FROM messages
    WHERE id = ?;
    `,
    [insertResult.lastID]
  );

  io.to(`user_${senderId}`).emit("message:new", message);
  io.to(`user_${recipientId}`).emit("message:new", message);
  return message;
}

app.get("/api/messages/:otherUserId", authMiddleware, async (req, res) => {
  const otherUserId = Number(req.params.otherUserId);
  if (!Number.isInteger(otherUserId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const exists = await get("SELECT id FROM users WHERE id = ?;", [otherUserId]);
    if (!exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const messages = await all(
      `
      SELECT
        id,
        sender_id AS senderId,
        recipient_id AS recipientId,
        message_type AS type,
        content,
        created_at AS createdAt
      FROM messages
      WHERE (sender_id = ? AND recipient_id = ?)
         OR (sender_id = ? AND recipient_id = ?)
      ORDER BY id ASC;
      `,
      [req.userId, otherUserId, otherUserId, req.userId]
    );

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: "Could not load messages" });
  }
});

app.post("/api/messages", authMiddleware, async (req, res) => {
  const recipientId = Number(req.body.recipientId);
  const text = String(req.body.text || "").trim();

  if (!Number.isInteger(recipientId)) {
    res.status(400).json({ error: "Recipient id is required" });
    return;
  }

  if (!text) {
    res.status(400).json({ error: "Message text is required" });
    return;
  }

  try {
    const recipient = await get("SELECT id FROM users WHERE id = ?;", [recipientId]);
    if (!recipient) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    const message = await createAndBroadcastMessage({
      senderId: req.userId,
      recipientId,
      type: "text",
      content: text
    });

    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: "Could not send message" });
  }
});

app.post("/api/messages/media", authMiddleware, upload.single("media"), async (req, res) => {
  const recipientId = Number(req.body.recipientId);

  if (!Number.isInteger(recipientId)) {
    res.status(400).json({ error: "Recipient id is required" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "Media file is required" });
    return;
  }

  try {
    const recipient = await get("SELECT id FROM users WHERE id = ?;", [recipientId]);
    if (!recipient) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    const type = req.file.mimetype.startsWith("video/") ? "video" : "image";
    const fileUrl = `/uploads/${req.file.filename}`;

    const message = await createAndBroadcastMessage({
      senderId: req.userId,
      recipientId,
      type,
      content: fileUrl
    });

    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: "Could not send media" });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "File is too large (max 25MB)" });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }

  if (err && err.message) {
    res.status(400).json({ error: err.message });
    return;
  }

  next(err);
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    next();
  } catch (err) {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user_${socket.userId}`);
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database startup failed:", err);
    process.exit(1);
  });
