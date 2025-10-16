import express from "express";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Allow frontend calls from any origin
app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// ✅ Create writable temporary directory for cache
const dataDir = path.join(os.tmpdir(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created temporary data directory at ${dataDir}`);
}

// ✅ SQLite cache setup
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

// ✅ Secret key for admin cache clearing
const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";

// 🧠 Proxy endpoints (fallback rotation)
const PROXY_LIST = [
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?",
  "https://thingproxy.freeboard.io/fetch/",
];

// ✅ Helper: fetch inventory with proxy fallback
async function fetchInventory(steamId) {
  const baseUrl = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;

  for (let i = 0; i <= PROXY_LIST.length; i++) {
    const useProxy = i < PROXY_LIST.length;
    const proxyPrefix = useProxy ? PROXY_LIST[i] : "";
    const url = useProxy ? `${proxyPrefix}${encodeURIComponent(baseUrl)}` : baseUrl;

    console.log(`🌐 Fetching ${steamId} ${useProxy ? `(via ${proxyPrefix})` : "(direct)"}`);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Connection": "keep-alive",
        },
      });

      console.log(`🔍 Steam status: ${response.status} ${response.statusText}`);

      const rawText = await response.text();
      if (response.ok) {
        console.log(`✅ Successfully fetched inventory for ${steamId} (${useProxy ? "proxy" : "direct"})`);
        return JSON.parse(rawText);
      } else {
        console.warn(`⚠️ Attempt ${i + 1} failed (${response.status}): ${rawText.slice(0, 150)}`);
      }
    } catch (err) {
      console.warn(`❌ Proxy #${i + 1} failed: ${err.message}`);
    }
  }

  throw new Error("All proxy attempts failed");
}

// ✅ API: fetch Unturned inventory for a given SteamID
app.get("/api/inventory/:steamId", async (req, res) => {
  try {
    const steamId = req.params.steamId;

    if (!/^\d{17}$/.test(steamId)) {
      return res.status(400).json({ error: "Invalid SteamID64" });
    }

    const data = await fetchInventory(steamId);
    res.json(data);
  } catch (err) {
    console.error("❌ Steam API error:", err.message);
    res.status(500).json({ error: "Steam API request failed" });
  }
});

// ✅ Cached price lookup
app.get("/api/price/:item", (req, res) => {
  const item = req.params.item;
  db.get(
    "SELECT price, last_updated FROM market_cache WHERE item_name = ?",
    [item],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (row) res.json({ cached: true, ...row });
      else res.json({ cached: false });
    }
  );
});

// ✅ Clear cache (requires token)
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

// ✅ Test route
app.get("/ping", (req, res) => res.json({ ok: true, msg: "Server running" }));

// ✅ Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
