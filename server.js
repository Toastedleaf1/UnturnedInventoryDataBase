import express from "express";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Create a writable temporary directory for caching
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created temporary data directory at ${dataDir}`);
}

// ✅ SQLite cache setup
const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Failed to open database:", err.message);
  } else {
    console.log(`✅ Connected to SQLite database at ${dbPath}`);
  }
});

// ✅ Create the cache table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS market_cache (
    item_name TEXT PRIMARY KEY,
    price REAL,
    last_updated INTEGER
  )
`);

// ✅ Serve static files (index.html, CSS, etc.)
app.use(express.static("public"));
app.use(express.json());

// ✅ Secret key for admin cache clearing
const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";

// ✅ Fetch Unturned inventory from Steam for a given Steam ID
app.get("/api/inventory/:steamId", async (req, res) => {
  try {
    const steamId = req.params.steamId;
    const url = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;

    console.log(`🌐 Fetching Steam inventory for ${steamId}`);

    // 👇 Add User-Agent to avoid Steam’s bot filtering
   const response = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9"
  },
});

    if (!response.ok) {
      throw new Error(`Failed to fetch Steam inventory for ${steamId}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Steam API error:", err.message);
    res.status(500).json({ error: "Steam API request failed" });
  }
});

// ✅ Example cached price fetch
app.get("/api/price/:item", (req, res) => {
  const item = req.params.item;
  db.get(
    "SELECT price, last_updated FROM market_cache WHERE item_name = ?",
    [item],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (row) {
        res.json({ cached: true, ...row });
      } else {
        res.json({ cached: false });
      }
    }
  );
});

// ✅ Clear cache route (requires token)
app.post("/api/clear-cache", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== SECRET_TOKEN) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  db.run("DELETE FROM market_cache", (err) => {
    if (err) return res.status(500).json({ error: "Failed to clear cache" });
    res.json({ success: true, message: "Cache cleared successfully" });
  });
});

// ✅ Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
