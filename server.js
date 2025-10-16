import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ✅ Create writable temp directory for Render
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Failed to open database:", err.message);
  else console.log(`✅ Connected to SQLite at ${dbPath}`);
});

// ✅ Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS inventories (
      steam_id TEXT PRIMARY KEY,
      item_count INTEGER,
      last_updated INTEGER,
      data TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS market_cache (
      item_name TEXT PRIMARY KEY,
      price REAL,
      last_updated INTEGER
    )
  `);
});

// ✅ Save inventory from frontend
app.post("/api/save-inventory", (req, res) => {
  const { steamId, inventory } = req.body;

  if (!steamId || !Array.isArray(inventory)) {
    return res.status(400).json({ error: "Invalid data format" });
  }

  const itemCount = inventory.length;
  const jsonData = JSON.stringify(inventory);
  const timestamp = Date.now();

  db.run(
    `
    INSERT INTO inventories (steam_id, item_count, last_updated, data)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(steam_id)
    DO UPDATE SET item_count = ?, last_updated = ?, data = ?
  `,
    [steamId, itemCount, timestamp, jsonData, itemCount, timestamp, jsonData],
    (err) => {
      if (err) return res.status(500).json({ error: "DB insert failed" });
      console.log(`💾 Saved inventory for ${steamId} (${itemCount} items)`);
      res.json({ success: true, items: itemCount });
    }
  );
});

// ✅ Leaderboard (most items)
app.get("/api/leaderboard", (req, res) => {
  db.all(
    `SELECT steam_id, item_count, last_updated FROM inventories ORDER BY item_count DESC LIMIT 50`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    }
  );
});

// ✅ Search inventories by Steam ID
app.get("/api/search/:steamId", (req, res) => {
  const { steamId } = req.params;
  db.get(
    `SELECT data, last_updated FROM inventories WHERE steam_id = ?`,
    [steamId],
    (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ inventory: JSON.parse(row.data), last_updated: row.last_updated });
    }
  );
});

// ✅ Server test
app.get("/ping", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
