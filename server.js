import express from "express";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Create temporary writable directory for Render
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created temporary data directory at ${dataDir}`);
}

// ✅ SQLite database path (in temp dir)
const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Failed to open database:", err.message);
  else console.log(`✅ Connected to SQLite database at ${dbPath}`);
});

// ✅ Initialize cache table
db.run(`
  CREATE TABLE IF NOT EXISTS market_cache (
    steam_id TEXT PRIMARY KEY,
    data TEXT,
    timestamp INTEGER
  )
`);

// ✅ Middleware
app.use(express.json());
app.use(express.static("public"));

// ✅ Steam API Fetch (Unturned AppID 304930)
app.get("/api/inventory/:steamId", async (req, res) => {
  const steamId = req.params.steamId;
  const cacheTTL = 1000 * 60 * 10; // 10 minutes
  const now = Date.now();

  try {
    // Check cache
    db.get("SELECT data, timestamp FROM market_cache WHERE steam_id = ?", [steamId], async (err, row) => {
      if (err) {
        console.error("❌ Cache lookup failed:", err.message);
      }

      if (row && now - row.timestamp < cacheTTL) {
        console.log(`💾 Served cached data for ${steamId}`);
        return res.json(JSON.parse(row.data));
      }

      // Fetch from Steam API
      const url = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch Steam inventory for ${steamId}`);

      const data = await response.json();

      // Save to cache
      db.run(
        "INSERT OR REPLACE INTO market_cache (steam_id, data, timestamp) VALUES (?, ?, ?)",
        [steamId, JSON.stringify(data), now],
        (err) => {
          if (err) console.error("⚠️ Failed to write cache:", err.message);
        }
      );

      console.log(`🌐 Fetched and cached new data for ${steamId}`);
      res.json(data);
    });
  } catch (err) {
    console.error("❌ Steam API error:", err);
    res.status(500).json({ error: "Steam API request failed" });
  }
});

// ✅ Clear cache endpoint (requires secret token)
app.post("/api/clear-cache", (req, res) => {
  const token = req.headers["x-secret-token"];
  if (token !== "supersecretkey123") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  db.run("DELETE FROM market_cache", (err) => {
    if (err) {
      console.error("❌ Failed to clear cache:", err.message);
      res.status(500).json({ error: "Failed to clear cache" });
    } else {
      console.log("🧹 Cache cleared successfully");
      res.json({ message: "Cache cleared" });
    }
  });
});

// ✅ Serve index.html for all unmatched routes (SPA support)
app.get("*", (req, res) => {
  res.sendFile(path.resolve("public", "index.html"));
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
