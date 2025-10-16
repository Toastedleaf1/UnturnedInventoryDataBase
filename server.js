import express from "express";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Allow frontend calls
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ✅ Create temporary data directory for database
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created temporary data directory at ${dataDir}`);
}

// ✅ Initialize SQLite
const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Failed to open database:", err.message);
  else console.log(`✅ Connected to SQLite database at ${dbPath}`);
});

// ✅ Create tables if missing
db.run(`
  CREATE TABLE IF NOT EXISTS market_cache (
    item_name TEXT PRIMARY KEY,
    price REAL,
    last_updated INTEGER
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS saved_inventories (
    steam_id TEXT PRIMARY KEY,
    item_count INTEGER,
    inventory_json TEXT,
    last_updated INTEGER
  )
`);

// ✅ Secret key for admin cache clearing
const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";

// ✅ Helper function for fetching inventory (with proxy fallback)
async function fetchInventory(steamId, useProxy = false, proxyChoice = 0) {
  const directUrl = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;

  const proxyList = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(directUrl)}`
  ];
  const url = useProxy ? proxyList[proxyChoice] : directUrl;

  console.log(`🌐 Attempting ${useProxy ? "Proxy" : "Direct"} fetch${useProxy ? " via " + proxyList[proxyChoice] : ""} for ${steamId}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive",
    },
  });

  console.log(`🔍 [${useProxy ? "Proxy" : "Direct"}] Status ${response.status}: ${response.statusText}`);
  const rawText = await response.text();
  console.log(`🧾 [${useProxy ? "Proxy" : "Direct"}] Response preview:`, rawText.slice(0, 300));

  if (!response.ok || !rawText || rawText === "null") {
    throw new Error(`Invalid or blocked response (${response.status})`);
  }

  return JSON.parse(rawText);
}

// ✅ API: Fetch Unturned inventory
app.get("/api/inventory/:steamId", async (req, res) => {
  try {
    const steamId = req.params.steamId;
    if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: "Invalid SteamID64" });

    let data;
    try {
      data = await fetchInventory(steamId);
    } catch (err1) {
      console.warn(`⚠️ Direct failed: ${err1.message}, retrying with proxy...`);
      try {
        data = await fetchInventory(steamId, true, 0);
      } catch (err2) {
        console.warn(`⚠️ AllOrigins failed: ${err2.message}, retrying with CorsProxy.io...`);
        try {
          data = await fetchInventory(steamId, true, 1);
        } catch (err3) {
          console.error(`❌ Proxy fetch failed: ${err3.message}`);
          return res.status(500).json({ error: "Steam API unreachable (direct and proxy failed)" });
        }
      }
    }

    res.json(data);
  } catch (err) {
    console.error("❌ Steam API error:", err.message);
    res.status(500).json({ error: "Steam API request failed" });
  }
});

// ✅ Save inventory to database
app.post("/api/save-inventory", (req, res) => {
  const { steamId, inventory } = req.body;
  if (!steamId || !Array.isArray(inventory)) {
    return res.status(400).json({ error: "Invalid data" });
  }

  const now = Date.now();
  const itemCount = inventory.length;

  db.run(
    `INSERT INTO saved_inventories (steam_id, item_count, inventory_json, last_updated)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET
       item_count = excluded.item_count,
       inventory_json = excluded.inventory_json,
       last_updated = excluded.last_updated`,
    [steamId, itemCount, JSON.stringify(inventory), now],
    (err) => {
      if (err) return res.status(500).json({ error: "Database save error" });
      console.log(`💾 Saved ${itemCount} items for ${steamId}`);
      res.json({ success: true, items: itemCount });
    }
  );
});

// ✅ Leaderboard
app.get("/api/leaderboard", (req, res) => {
  db.all(
    "SELECT steam_id, item_count FROM saved_inventories ORDER BY item_count DESC LIMIT 20",
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Database error" });
      res.json(rows || []);
    }
  );
});

// ✅ Search saved inventory
app.get("/api/search/:steamId", (req, res) => {
  const { steamId } = req.params;
  db.get(
    "SELECT inventory_json, last_updated FROM saved_inventories WHERE steam_id = ?",
    [steamId],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (!row) return res.status(404).json({ error: "Inventory not found" });
      res.json({
        inventory: JSON.parse(row.inventory_json),
        last_updated: row.last_updated,
      });
    }
  );
});

// ✅ Clear cache (requires secret token)
app.post("/api/clear-cache", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Unauthorized" });

  db.run("DELETE FROM market_cache", (err) => {
    if (err) return res.status(500).json({ error: "Failed to clear cache" });
    console.log("🧹 Cache cleared successfully");
    res.json({ success: true, message: "Cache cleared successfully" });
  });
});

// ✅ Simple test route
app.get("/ping", (req, res) => res.json({ ok: true, msg: "Server running" }));

// ✅ Start the server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
