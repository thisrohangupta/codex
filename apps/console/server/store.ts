import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'devdb.json');

type Table<T> = Record<string, T>;

export type DbShape = {
  plans: Table<any>;
  runs: Table<any>;
  approvals: Table<any>;
  environments: Table<any>;
  audits: Table<any>;
};

function ensure() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ plans: {}, runs: {}, approvals: {}, environments: {}, audits: {} }, null, 2));
}

function read(): DbShape {
  ensure();
  return JSON.parse(fs.readFileSync(dbFile, 'utf-8')) as DbShape;
}

function write(db: DbShape) {
  ensure();
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

export function upsert(table: keyof DbShape, id: string, row: any) {
  const db = read();
  (db[table] as Table<any>)[id] = row;
  write(db);
}

export function get<T>(table: keyof DbShape, id: string): T | undefined {
  const db = read();
  return (db[table] as Table<T>)[id];
}

export function list<T>(table: keyof DbShape): T[] {
  const db = read();
  return Object.values(db[table] as Table<T>);
}

export function remove(table: keyof DbShape, id: string) {
  const db = read();
  delete (db[table] as Table<any>)[id];
  write(db);
}

