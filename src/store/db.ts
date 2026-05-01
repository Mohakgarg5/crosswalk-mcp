import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyMigrations } from './migrations.ts';
import { paths } from '../config.ts';

export type Db = Database.Database;

export function openDb(file?: string): Db {
  const target = file ?? paths.dbFile();
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}
