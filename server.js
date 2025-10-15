import express from "express";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const dbPath = "/data/market_cache.db";
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS market_cache (item_id TEXT PRIMARY KEY, price REAL, last_updated INTEGER)");
});

const SECRET_TOKEN = "supersecretkey123";

app.post("/api/clear-cache", (req, res) => {
  const { token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ success: false, message: "Invalid token." });
  db.run("DELETE FROM market_cache", err => {
    if (err) return res.status(500).json({ success: false, message: "Error clearing cache." });
    res.json({ success: true, message: "Cache cleared successfully." });
  });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
