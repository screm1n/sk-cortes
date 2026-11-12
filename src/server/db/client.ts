import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";

const aqui = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;

  for (const p of [dirname(config.dbPath), ...Object.values(config.pastas)]) {
    mkdirSync(p, { recursive: true });
  }
  const conn = new Database(config.dbPath);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  // O CLI da skill e o servidor abrem o mesmo banco ao mesmo tempo.
  conn.pragma("busy_timeout = 5000");

  conn.exec(readFileSync(join(aqui, "schema.sql"), "utf8"));
  migrarColunas(conn);
  conn.exec(readFileSync(join(aqui, "seed.sql"), "utf8"));

  _db = conn;
  return conn;
}

/**
 * CREATE TABLE IF NOT EXISTS nao adiciona coluna em tabela que ja existe, entao
 * coluna nova precisa de ALTER. Roda a cada boot e ignora quem ja esta la.
 */
function migrarColunas(conn: Database.Database): void {
  const novas: [string, string, string][] = [
    ["momentos", "edicao", "TEXT"],
    ["videos", "trecho", "TEXT"],
  ];
  for (const [tabela, coluna, tipo] of novas) {
    const existe = (conn.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[])
      .some((c) => c.name === coluna);
    if (!existe) conn.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  }
}

/** Testes apontam pra um banco em memoria. */
export function usarDb(conn: Database.Database): void {
  conn.exec(readFileSync(join(aqui, "schema.sql"), "utf8"));
  conn.exec(readFileSync(join(aqui, "seed.sql"), "utf8"));
  _db = conn;
}
