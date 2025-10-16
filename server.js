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

// ✅ Helper to safely fetch + log what Steam returns
async function tryFetch(url, steamId, proxyLabel) {
  console.log(`🌐 Attempting ${proxyLabel} fetch for ${steamId}`);

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Referer": "https://steamcommunity.com/",
    "Origin": "https://steamcommunity.com"
  };

  const response = await fetch(url, { headers });
  const text = await response.text();

  console.log(`🔍 [${proxyLabel}] Status ${response.status}: ${response.statusText}`);
  console.log(`🧾 [${proxyLabel}] Response preview:\n${text.slice(0, 400)}`);

  if (!response.ok || text.includes("<html") || text.trim() === "" || text === "null") {
    throw new Error(`Invalid or blocked response from ${proxyLabel}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${proxyLabel}`);
  }
}

// ✅ Main function with proxy rotation
async function fetchInventory(steamId) {
  const baseUrl = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;
  const urls = [
    { url: baseUrl, label: "Direct" },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(baseUrl)}`, label: "AllOrigins Proxy" },
    { url: `https://corsproxy.io/?${encodeURIComponent(baseUrl)}`, label: "CorsProxy.io" }
  ];

  for (const { url, label } of urls) {
    try {
      const data = await tryFetch(url, steamId, label);
      if (data && data.assets) {
        console.log(`✅ Success using ${label}`);
        return data;
      }
    } catch (err) {
      console.warn(`⚠️ ${label} failed: ${err.message}`);
    }
  }

  throw new Error("All methods failed or returned blocked responses.");
}

// ✅ API: Get Unturned inventory
app.get("/api/inventory/:steamId", async (req, res) => {
  const { steamId } = req.params;

  if (!steamId || !/^\d{17}$/.test(steamId))
    return res.status(400).json({ error: "Invalid SteamID64" });

  try {
    const data = await fetchInventory(steamId);
    res.json(data);
  } catch (err) {
    console.error("❌ Steam API error:", err.message);
    res.status(500).json({
      error: "Steam API request failed",
      details: err.message
    });
  }
});

// ✅ Cached price lookup
app.get("/api/price/:item", (req, res) => {
  const { item } = req.params;
  db.get("SELECT price, last_updated FROM market_cache WHERE item_name = ?", [item], (err, row) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (row) res.json({ cached: true, ...row });
    else res.json({ cached: false });
  });
});

// ✅ Clear cache (requires secret token)
app.post("/api/clear-cache", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Unauthorized" });

  db.run("DELETE FROM market_cache", (err) => {
    if (err) return res.status(500).json({ error: "Failed to clear cache" });
    res.json({ success: true, message: "Cache cleared successfully" });
  });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
