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

// ✅ Create writable temp directory
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ✅ SQLite setup
const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) =>
  err ? console.error("❌ DB Error:", err.message) : console.log("✅ Connected to cache DB")
);

db.run(`
  CREATE TABLE IF NOT EXISTS market_cache (
    item_name TEXT PRIMARY KEY,
    price REAL,
    last_updated INTEGER
  )
`);

const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";

// ✅ Helper: fetch inventory with multiple fallback layers
async function fetchInventory(steamId) {
  const urls = [
    {
      name: "Direct",
      url: `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`,
    },
    {
      name: "AllOrigins Proxy",
      url: `https://api.allorigins.win/raw?url=${encodeURIComponent(
        `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`
      )}`,
    },
    {
      name: "SCMM",
      url: `https://scmm.app/api/profile/${steamId}/inventory`,
    },
  ];

  for (const { name, url } of urls) {
    try {
      console.log(`🌐 Attempting ${name} fetch for ${steamId}`);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      console.log(`🔍 [${name}] Status ${res.status}: ${res.statusText}`);
      const text = await res.text();
      if (!res.ok || !text || text === "null") {
        console.warn(`⚠️ ${name} failed or returned null`);
        continue;
      }

      const data = JSON.parse(text);
      if (!data || Object.keys(data).length === 0) continue;

      data.source = name; // track which source succeeded
      return data;
    } catch (err) {
      console.warn(`⚠️ ${name} error: ${err.message}`);
    }
  }

  throw new Error("All fetch methods failed");
}

// ✅ Inventory API
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

// ✅ Clear cache route
app.post("/api/clear-cache", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== SECRET_TOKEN)
    return res.status(403).json({ error: "Unauthorized" });

  db.run("DELETE FROM market_cache", (err) => {
    if (err) return res.status(500).json({ error: "Failed to clear cache" });
    res.json({ success: true, message: "Cache cleared successfully" });
  });
});

// ✅ Start server
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
