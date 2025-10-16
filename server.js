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

// ✅ Database setup
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath);

db.run(`
  CREATE TABLE IF NOT EXISTS market_cache (
    item_name TEXT PRIMARY KEY,
    price REAL,
    last_updated INTEGER
  )
`);

// ✅ Endpoint to save inventory results
app.post("/api/save-inventory", (req, res) => {
  const { steamId, inventory } = req.body;
  if (!steamId || !inventory) {
    return res.status(400).json({ error: "Missing steamId or inventory data" });
  }
  console.log(`📦 Received inventory from ${steamId}, ${inventory.length} items.`);
  res.json({ success: true });
});

// ✅ Example cache fetch
app.get("/api/price/:item", (req, res) => {
  db.get(
    "SELECT price, last_updated FROM market_cache WHERE item_name = ?",
    [req.params.item],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      res.json(row || { cached: false });
    }
  );
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
