import fs from "fs";
import os from "os";
import path from "path";
import sqlite3 from "sqlite3";

// ✅ Use writable temporary directory
const dataDir = path.join(os.tmpdir(), "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created temporary data directory at ${dataDir}`);
}

const dbPath = path.join(dataDir, "market_cache.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Failed to open database:", err.message);
  } else {
    console.log(`✅ Connected to SQLite database at ${dbPath}`);
  }
});
