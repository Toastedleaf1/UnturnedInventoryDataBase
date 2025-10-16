import express from "express";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// ==================== DATABASE SETUP ====================
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Database Error:", err.message);
  else console.log(`✅ Connected to SQLite at ${dbPath}`);
});

db.run(`
  CREATE TABLE IF NOT EXISTS market_cache (
    item_name TEXT PRIMARY KEY,
    price REAL,
    last_updated INTEGER
  )
`);

const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";

// ==================== INVENTORY FETCH ====================
async function fetchInventory(steamId, method = "direct") {
  let url;
  switch (method) {
    case "direct":
      url = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;
      break;
    case "allorigins":
      url = `https://api.allorigins.win/raw?url=${encodeURIComponent(
        `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`
      )}`;
      break;
    case "corsproxy":
      url = `https://corsproxy.io/?https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;
      break;
    case "scmm":
      // ✅ NEW fallback: SCMM endpoint
      url = `https://rust.scmm.app/inventory/${steamId}`;
      break;
  }

  console.log(`🌐 Fetching [${method}] inventory for ${steamId}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  console.log(`🔍 [${method}] Status ${response.status}: ${response.statusText}`);
  const text = await response.text();
  console.log(`🧾 [${method}] Preview:`, text.slice(0, 300));

  if (!response.ok || !text || text === "null") throw new Error(`Bad response from ${method}`);
  return JSON.parse(text);
}

// ==================== API ROUTES ====================
app.get("/api/inventory/:steamId", async (req, res) => {
  const steamId = req.params.steamId;

  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: "Invalid SteamID64" });
  }

  const methods = ["direct", "allorigins", "corsproxy", "scmm"];

  for (const method of methods) {
    try {
      const data = await fetchInventory(steamId, method);

      // ✅ Validate structure before sending
      if (data && (data.assets || data.items || Array.isArray(data))) {
        console.log(`✅ Success with method: ${method}`);
        return res.json(data);
      } else {
        console.warn(`⚠️ ${method} returned invalid structure`);
      }
    } catch (err) {
      console.warn(`⚠️ ${method} failed: ${err.message}`);
    }
  }

  console.error("❌ All fetch methods failed.");
  res.status(500).json({ error: "Failed to fetch inventory from all sources." });
});

// ==================== CACHE + ADMIN ====================
app.get("/api/price/:item", (req, res) => {
  db.get(
    "SELECT price, last_updated FROM market_cache WHERE item_name = ?",
    [req.params.item],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      res.json(row ? { cached: true, ...row } : { cached: false });
    }
  );
});

app.post("/api/clear-cache", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Unauthorized" });

  db.run("DELETE FROM market_cache", (err) => {
    if (err) return res.status(500).json({ error: "Failed to clear cache" });
    res.json({ success: true, message: "Cache cleared successfully" });
  });
});

// ==================== TEST ROUTE ====================
app.get("/ping", (req, res) => res.json({ ok: true, msg: "Server running" }));

// ==================== START ====================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

