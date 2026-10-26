import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { logger } from "../../logging/logger.js";

export class SqliteDatabase {
  private db: DatabaseSync | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = ":memory:") {
    this.dbPath = dbPath;
  }

  public connect(): DatabaseSync {
    if (this.db) return this.db;

    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (this.dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = NORMAL;");
    }

    return this.db;
  }

  public migrate(migrationsDir?: string): void {
    const db = this.connect();
    const targetDir = migrationsDir || path.resolve(process.cwd(), "migrations");

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const appliedRows = db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all() as Array<{ version: number }>;
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    if (fs.existsSync(targetDir)) {
      const files = fs.readdirSync(targetDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const match = file.match(/^(\d+)_/);
        if (!match) continue;
        const version = parseInt(match[1], 10);
        if (appliedVersions.has(version)) continue;

        logger.info({ migration: file, version }, "Applying database migration");
        const sql = fs.readFileSync(path.join(targetDir, file), "utf-8");
        db.exec("BEGIN;");
        try {
          db.exec(sql);
          db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
            version,
            new Date().toISOString()
          );
          db.exec("COMMIT;");
        } catch (err) {
          db.exec("ROLLBACK;");
          throw err;
        }
      }
    }
  }

  public getRawDb(): DatabaseSync {
    return this.connect();
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
