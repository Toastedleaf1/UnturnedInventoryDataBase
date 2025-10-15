import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import sqlite3 from "sqlite3";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Use writable temporary directory (works on Render free plan)
const dataDir = path.join(os.tmpdir(), "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created temporary data directory at ${dataDir}`);
}

// ✅ Setup SQLite database in /tmp
const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Failed to open database:", err.message);
  } else {
    console.log(`✅ Connected to SQLite database at ${dbPath}`);
  }
});

// ✅ Ensure market_cache table exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS market_cache (
      item_id TEXT PRIMARY KEY,
      price REAL,
      last_updated INTEGER
    )
  `);
});

// ✅ Middleware
app.use(bodyParser.json());
app.use(express.static("public"));

// ✅ Secret token for admin actions
const SECRET_TOKEN = "supersecretkey123";

// ✅ Fetch cached price
app.get("/api/price/:item_id", (req, res) => {
  const itemId = req.params.item_id;

  db.get(
    "SELECT price, last_updated FROM market_cache WHERE item_id = ?",
    [itemId],
    (err, row) => {
      if (err) {
        console.error("DB read error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (row) {
        res.json({
          item_id: itemId,
          price: row.price,
          last_updated: row.last_updated,
        });
      } else {
        res.json({ item_id: itemId, price: null });
      }
    }
  );
});

// ✅ Update cached price (requires secret token)
app.post("/api/update", (req, res) => {
  const { token, item_id, price } = req.body;

  if (token !== SECRET_TOKEN) {
    return res.status(403).json({ error: "Invalid secret token" });
  }

  const timestamp = Date.now();
  db.run(
    `INSERT INTO market_cache (item_id, price, last_updated)
     VALUES (?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       price = excluded.price,
       last_updated = excluded.last_updated`,
    [item_id, price, timestamp],
    (err) => {
      if (err) {
        console.error("DB write error:", err);
        return res.status(500).json({ error: "Failed to update cache" });
      }
      res.json({ success: true });
    }
  );
});

// ✅ Clear cache (requires secret token)
app.post("/api/clear-cache", (req, res) => {
  const { token } = req.body;
  if (token !== SECRET_TOKEN) {
    return res.status(403).json({ error: "Invalid secret token" });
  }

  db.run("DELETE FROM market_cache", (err) => {
    if (err) {
      console.error("Cache clear error:", err);
      return res.status(500).json({ error: "Failed to clear cache" });
    }
    console.log("🗑️ Cache cleared successfully");
    res.json({ success: true });
  });
});

// ✅ Serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
