import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";

// ✅ Use writable temporary directory for Render
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created temporary data directory at ${dataDir}`);
}

// ✅ SQLite setup
const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Failed to open database:", err.message);
  else console.log(`✅ Connected to SQLite database at ${dbPath}`);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS market_cache (
      item_name TEXT PRIMARY KEY,
      price REAL,
      timestamp INTEGER
  )`);
});

app.use(express.static("public"));
app.use(express.json());

// ✅ Steam inventory fetch
app.get("/api/inventory/:steamId", async (req, res) => {
  try {
    const { steamId } = req.params;
    const url = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch Steam inventory for ${steamId}`);

    const data = await response.json();
    if (!data || !data.assets)
      return res.status(404).json({ error: "No inventory found for this Steam ID" });

    res.json(data);
  } catch (err) {
    console.error("❌ Steam API error:", err.message);
    res.status(500).json({ error: err.message || "Steam API request failed" });
  }
});

// ✅ Market caching
app.get("/api/price/:itemName", (req, res) => {
  const { itemName } = req.params;
  db.get(
    "SELECT price, timestamp FROM market_cache WHERE item_name = ?",
    [itemName],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Item not cached" });
      res.json(row);
    }
  );
});

app.post("/api/price/:itemName", (req, res) => {
  const { itemName } = req.params;
  const { price } = req.body;
  const timestamp = Date.now();
  db.run(
    "INSERT OR REPLACE INTO market_cache (item_name, price, timestamp) VALUES (?, ?, ?)",
    [itemName, price, timestamp],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// ✅ Secure cache clearing
app.post("/api/clear-cache", (req, res) => {
  const { token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Invalid secret token" });

  db.run("DELETE FROM market_cache", (err) => {
    if (err) return res.status(500).json({ error: err.message });
    console.log("🧹 Cache cleared manually.");
    res.json({ success: true });
  });
});

// ✅ Ping test endpoint
app.get("/api/ping", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
