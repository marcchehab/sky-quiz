// SQLite (node:sqlite, no extra dependency). Blobs (audio, pictures, sounds) live as files next to it.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const DATA = process.env.DATA_DIR || new URL('./data/', import.meta.url).pathname
export const BLOBS = join(DATA, 'blobs')
mkdirSync(BLOBS, { recursive: true })

export const db = new DatabaseSync(join(DATA, 'skystories.db'))
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT,                      -- scrypt: salt$hash (hex), NULL = magic link / passkey only
  verified INTEGER NOT NULL DEFAULT 0,
  canPublish INTEGER NOT NULL DEFAULT 1,
  isAdmin INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,                -- credential id (base64url)
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publicKey BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,                -- chosen by the page
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | published
  blocked INTEGER NOT NULL DEFAULT 0,      -- set by an admin
  data TEXT NOT NULL,                 -- story JSON; audio/img/sfx are blob hashes
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  published INTEGER
);
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,              -- sha256 hex of the content
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  userId INTEGER NOT NULL,            -- first uploader (counts against their quota)
  created INTEGER NOT NULL
);
`)

export const q = sql => db.prepare(sql)
