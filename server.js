/* server.js
   Robust Unturned Steam Inventory fetcher + SQLite store
   - Node 18+ (uses built-in fetch)
   - Retries + timeout + user-agent + optional proxy fallback
   - Caches inventories & items in SQLite
*/
import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || "supersecretkey123";
const DEBUG = (process.env.DEBUG || "false") === "true";
const PROXY_URLS = (process.env.PROXY_URLS || "").split(",").map(s => s.trim()).filter(Boolean);

// Pick data dir: prefer persistent /data (if writable), otherwise tmp
let dataDir = "/data";
try {
  fs.accessSync("/data", fs.constants.W_OK);
} catch (_) {
  dataDir = path.join(os.tmpdir(), "unturned-inventory-data");
}
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
console.log(`Using data directory: ${dataDir}`);

const DB_PATH = path.join(dataDir, "unturned_inventory.db");
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Failed to open DB:", err.message);
  else console.log("SQLite DB opened at", DB_PATH);
});

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS inventories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steamid TEXT NOT NULL,
  appid INTEGER NOT NULL,
  contextid TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  raw_json TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL,
  assetid TEXT,
  classid TEXT,
  instanceid TEXT,
  market_hash_name TEXT,
  name TEXT,
  type TEXT,
  icon_url TEXT,
  amount INTEGER,
  raw_json TEXT,
  FOREIGN KEY(inventory_id) REFERENCES inventories(id)
);
CREATE INDEX IF NOT EXISTS idx_items_marketname ON items(market_hash_name);
`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Helper: sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Helper: fetch with retries, timeout, headers and optional proxy fallback
async function fetchWithRetries(url, opts = {}, attempts = 3, timeoutMs = 8000) {
  const defaultHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive"
  };
  const finalOpts = { ...opts, headers: { ...(opts.headers || {}), ...defaultHeaders } };

  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...finalOpts, signal: controller.signal });
      clearTimeout(id);
      // read text for debug and to avoid JSON parse errors
      const text = await resp.text();
      if (DEBUG) {
        console.log(`fetch attempt ${i+1} - ${url} -> ${resp.status} ${resp.statusText}`);
        console.log("raw response snippet:", text.slice(0, 500));
      }
      if (!resp.ok) {
        // for certain status codes we might want to retry
        if ([429, 500, 502, 503, 504].includes(resp.status) && i < attempts - 1) {
          const backoff = 500 * Math.pow(2, i);
          await sleep(backoff);
          continue;
        } else {
          const err = new Error(`HTTP ${resp.status} ${resp.statusText}`);
          err.raw = text;
          throw err;
        }
      }
      // parse JSON if possible
      try {
        const json = JSON.parse(text);
        return { ok: true, json, raw: text, status: resp.status };
      } catch (parseErr) {
        // return raw text if not JSON
        return { ok: true, json: null, raw: text, status: resp.status };
      }
    } catch (err) {
      clearTimeout(id);
      if (err.name === "AbortError") {
        if (DEBUG) console.warn("fetch timeout, will retry if attempts left");
      } else {
        if (DEBUG) console.warn("fetch error:", err.message);
      }
      if (i === attempts - 1) {
        // final attempt failed; try proxy fallback if available
        if (PROXY_URLS.length > 0) break;
        throw err;
      }
      const backoff = 500 * Math.pow(2, i);
      await sleep(backoff);
    }
  }

  // Proxy fallback: try proxies if configured
  for (const proxy of PROXY_URLS) {
    try {
      const proxiedUrl = proxy.endsWith("/") ? proxy + encodeURIComponent(url) : proxy + encodeURIComponent(url);
      if (DEBUG) console.log("Trying proxy:", proxiedUrl);
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(proxiedUrl, { method: "GET", signal: controller.signal, headers: finalOpts.headers });
      clearTimeout(id);
      const text = await resp.text();
      if (DEBUG) {
        console.log(`proxy fetch -> ${resp.status} ${resp.statusText}`);
        console.log("raw proxy response snippet:", text.slice(0, 500));
      }
      if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
      try {
        const json = JSON.parse(text);
        return { ok: true, json, raw: text, status: resp.status };
      } catch {
        return { ok: true, json: null, raw: text, status: resp.status };
      }
    } catch (err) {
      if (DEBUG) console.warn("Proxy attempt failed:", err.message);
      continue;
    }
  }

  // if we reach here, all attempts failed
  throw new Error("All fetch attempts (including proxies) failed");
}

// Endpoint: fetch and save inventory
app.post("/api/fetch", async (req, res) => {
  try {
    const { steamid, appid = 304930, contextid = "2" } = req.body;
    if (!steamid) return res.status(400).json({ error: "steamid required" });

    const url = `https://steamcommunity.com/inventory/${steamid}/${appid}/${contextid}?l=english&count=5000`;
    const result = await fetchWithRetries(url, {}, 3, 9000);

    // If we got a non-JSON page (like "private" HTML), capture raw and return helpful message
    if (!result.json) {
      const snippet = (result.raw || "").slice(0, 600);
      return res.status(502).json({ error: "Non-JSON response from Steam", snippet });
    }

    const data = result.json;

    // Save inventory entry
    const fetchedAt = Date.now();
    const insertInv = db.prepare(`INSERT INTO inventories (steamid, appid, contextid, fetched_at, raw_json) VALUES (?, ?, ?, ?, ?)`);
    const info = insertInv.run(steamid, appid, contextid, fetchedAt, JSON.stringify(data));
    const inventoryId = info.lastID || info.lastInsertRowid;

    // Map descriptions
    const descriptions = data.descriptions || [];
    const descMap = {};
    descriptions.forEach(d => {
      const key = `${d.classid}:${d.instanceid || 0}`;
      descMap[key] = d;
    });

    // Insert assets
    const assets = data.assets || [];
    const insertItem = db.prepare(`INSERT INTO items (inventory_id, assetid, classid, instanceid, market_hash_name, name, type, icon_url, amount, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction ? db.transaction((list) => { for (const a of list) { const key = `${a.classid}:${a.instanceid || 0}`; const desc = descMap[key]; const name = desc ? (desc.market_hash_name || desc.name) : null; const type = desc ? (desc.type || null) : null; const icon_url = desc && desc.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${desc.icon_url}` : null; const raw = JSON.stringify({ asset: a, desc: desc || null }); insertItem.run(inventoryId, a.assetid, a.classid, a.instanceid || '', name, desc ? desc.name : null, type, icon_url, a.amount || 1, raw); } }) : null;

    if (tx) {
      tx(assets);
    } else {
      for (const a of assets) {
        const key = `${a.classid}:${a.instanceid || 0}`;
        const desc = descMap[key];
        const name = desc ? (desc.market_hash_name || desc.name) : null;
        const type = desc ? (desc.type || null) : null;
        const icon_url = desc && desc.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${desc.icon_url}` : null;
        const raw = JSON.stringify({ asset: a, desc: desc || null });
        insertItem.run(inventoryId, a.assetid, a.classid, a.instanceid || '', name, desc ? desc.name : null, type, icon_url, a.amount || 1, raw);
      }
    }

    res.json({ ok: true, inventoryId, assets: assets.length, descriptions: descriptions.length });
  } catch (err) {
    console.error("Fetch/save inventory error:", err.message || err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Endpoint: quick fetch (no save) - useful for testing
app.get("/api/inventory/:steamId", async (req, res) => {
  try {
    const steamId = req.params.steamId;
    const url = `https://steamcommunity.com/inventory/${steamId}/304930/2?l=english&count=5000`;
    const result = await fetchWithRetries(url, {}, 3, 9000);
    if (!result.json) return res.status(502).json({ error: "Non-JSON response from Steam", snippet: (result.raw||"").slice(0,600) });
    res.json(result.json);
  } catch (err) {
    console.error("Steam API error:", err.message || err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// List inventories
app.get("/api/inventories", (req, res) => {
  db.all("SELECT id, steamid, appid, contextid, fetched_at FROM inventories ORDER BY fetched_at DESC LIMIT 200", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// List items for inventory
app.get("/api/inventories/:id/items", (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  db.all("SELECT * FROM items WHERE inventory_id = ? ORDER BY id", [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Simple search across items
app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  db.all("SELECT items.*, inventories.steamid FROM items JOIN inventories ON items.inventory_id = inventories.id WHERE items.market_hash_name LIKE ? OR items.name LIKE ? OR items.type LIKE ? ORDER BY items.id DESC LIMIT 500", [like, like, like], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Clear cache / inventories & items (protected)
app.post("/api/clear-all", (req, res) => {
  const token = req.headers["x-secret-token"] || req.body?.token;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "unauthorized" });
  db.exec("DELETE FROM items; DELETE FROM inventories;", (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, message: "All inventories and items cleared." });
  });
});

// Ping
app.get("/api/ping", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Serve SPA fallback handled by express.static earlier
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
