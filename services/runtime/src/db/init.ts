import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runtimeSchemaSql } from "./schema.js";

export interface RuntimeDatabaseOptions {
  databasePath?: string;
}

export interface RuntimeDatabaseHandle {
  database: DatabaseSync;
  databasePath: string;
}

export function getDefaultRuntimeDatabasePath() {
  return resolve(process.cwd(), "data", "clear402-runtime.sqlite");
}

export function initializeRuntimeDatabase(
  options: RuntimeDatabaseOptions = {}
): RuntimeDatabaseHandle {
  const databasePath = options.databasePath ?? getDefaultRuntimeDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(runtimeSchemaSql);
  migrateRuntimeDatabase(database);
  return { database, databasePath };
}

function migrateRuntimeDatabase(database: DatabaseSync) {
  const receiptColumns = new Set(
    (database.prepare(`pragma table_info(receipts)`).all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  const migrations = [
    ["resource", "TEXT"],
    ["asset", "TEXT"],
    ["service_result_hash", "TEXT"],
    ["caw_evidence_ref", "TEXT"],
    ["fallback_evidence_ref", "TEXT"],
    ["cobo_transaction_id", "TEXT"]
  ] as const;

  for (const [column, definition] of migrations) {
    if (!receiptColumns.has(column)) {
      database.exec(`ALTER TABLE receipts ADD COLUMN ${column} ${definition}`);
    }
  }
}
