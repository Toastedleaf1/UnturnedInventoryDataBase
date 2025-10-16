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

const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "market_cache.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Failed to open database:", err.message);
  else console.log(`✅ Connected to SQLite database at ${dbPath}`);
});

db.run(`
  CREATE TABLE IF NOT EXISTS market_cache (
    item_name TEXT PRIMARY KEY,
    price REAL,
    last_updated INTEGER
  )
`);

const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";

// 🧩 Helper to fetch inventory with proxy fallback
async function fetchInventory(steamId) {
  const baseUrl = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;
  const proxies = [
    baseUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(baseUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(baseUrl)}`
  ];

  for (const url of proxies) {
    try {
      console.log(`🌐 Trying ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Connection": "keep-alive"
        },
      });

      console.log(`🔍 Status ${response.status} ${response.statusText}`);
      const text = await response.text();

      if (text.includes("Access Denied") || text.trim() === "" || text === "null") {
        console.warn("⚠️ Proxy returned empty or blocked content.");
        continue;
      }

      const data = JSON.parse(text);
      if (data && data.assets) return data;

    } catch (err) {
      console.warn(`⚠️ Failed with ${url}:`, err.message);
    }
  }

  throw new Error("All proxies failed or returned invalid data.");
}

// 🚀 API: get inventory
app.get("/api/inventory/:steamId", async (req, res) => {
  const { steamId } = req.params;
  if (!steamId || !/^\d{17}$/.test(steamId))
    return res.status(400).json({ error: "Invalid SteamID64" });

  try {
    const data = await fetchInventory(steamId);
    res.json(data);
  } catch (err) {
    console.error("❌ Steam API error:", err.message);
    res.status(500).json({ error: "Steam API request failed" });
  }
});

// 🧮 Cached price check
app.get("/api/price/:item", (req, res) => {
  const { item } = req.params;
  db.get("SELECT price, last_updated FROM market_cache WHERE item_name = ?", [item], (err, row) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (row) res.json({ cached: true, ...row });
    else res.json({ cached: false });
  });
});

// 🔒 Clear cache (requires secret token)
app.post("/api/clear-cache", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Unauthorized" });

  db.run("DELETE FROM market_cache", (err) => {
    if (err) return res.status(500).json({ error: "Failed to clear cache" });
    res.json({ success: true, message: "Cache cleared successfully" });
  });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
