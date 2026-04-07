// sql-asm is the pure asm.js build — no WASM file required, works in Electron
// eslint-disable-next-line @typescript-eslint/no-var-requires
const initSqlJs = require('sql.js/dist/sql-asm.js');
import type { Database, SqlJsStatic } from 'sql.js';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { EmbeddingRecord, Modality } from './types';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS embeddings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path        TEXT    NOT NULL,
    file_hash        TEXT    NOT NULL,
    modality         TEXT    NOT NULL,
    chunk_index      INTEGER NOT NULL DEFAULT 0,
    embedding        BLOB    NOT NULL,
    summary          TEXT,
    file_size_bytes  INTEGER,
    duration_seconds REAL,
    indexed_at       INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunk
    ON embeddings(file_path, chunk_index);

  CREATE INDEX IF NOT EXISTS idx_file_path
    ON embeddings(file_path);
`;

function encodeEmbedding(embedding: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(embedding).buffer);
}

function decodeEmbedding(blob: Uint8Array): number[] {
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
}

export interface StoredEmbedding {
  filePath: string;
  modality: Modality;
  chunkIndex: number;
  embedding: number[];
  summary?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
}

export class ItoStore {
  private db!: Database;
  private readonly dbPath: string;

  constructor(pluginDir: string) {
    mkdirSync(pluginDir, { recursive: true });
    this.dbPath = join(pluginDir, 'ito.db');
  }

  // Must be called once before any other method
  async init(): Promise<void> {
    const SQL: SqlJsStatic = await initSqlJs();
    if (existsSync(this.dbPath)) {
      const fileBuffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }
    this.db.run(SCHEMA);
    this.persist();
  }

  upsert(record: EmbeddingRecord): void {
    this.db.run(`
      INSERT INTO embeddings
        (file_path, file_hash, modality, chunk_index, embedding, summary,
         file_size_bytes, duration_seconds, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path, chunk_index) DO UPDATE SET
        file_hash        = excluded.file_hash,
        modality         = excluded.modality,
        embedding        = excluded.embedding,
        summary          = excluded.summary,
        file_size_bytes  = excluded.file_size_bytes,
        duration_seconds = excluded.duration_seconds,
        indexed_at       = excluded.indexed_at
    `, [
      record.filePath,
      record.fileHash,
      record.modality,
      record.chunkIndex,
      encodeEmbedding(record.embedding),
      record.summary ?? null,
      record.fileSizeBytes ?? null,
      record.durationSeconds ?? null,
      Date.now(),
    ]);
    this.persist();
  }

  deleteFile(filePath: string): void {
    this.db.run('DELETE FROM embeddings WHERE file_path = ?', [filePath]);
    this.persist();
  }

  renameFile(oldPath: string, newPath: string): void {
    this.db.run('UPDATE embeddings SET file_path = ? WHERE file_path = ?', [newPath, oldPath]);
    this.persist();
  }

  getHash(filePath: string): string | null {
    const result = this.db.exec(
      'SELECT file_hash FROM embeddings WHERE file_path = ? LIMIT 1',
      [filePath]
    );
    if (!result.length || !result[0].values.length) return null;
    return result[0].values[0][0] as string;
  }

  getAllEmbeddings(): StoredEmbedding[] {
    const result = this.db.exec(`
      SELECT file_path, modality, chunk_index, embedding,
             summary, file_size_bytes, duration_seconds
      FROM embeddings
    `);
    if (!result.length) return [];

    return result[0].values.map(row => ({
      filePath:        row[0] as string,
      modality:        row[1] as Modality,
      chunkIndex:      row[2] as number,
      embedding:       decodeEmbedding(row[3] as Uint8Array),
      summary:         row[4] as string | undefined ?? undefined,
      fileSizeBytes:   row[5] as number | undefined ?? undefined,
      durationSeconds: row[6] as number | undefined ?? undefined,
    }));
  }

  getAllPaths(): string[] {
    const result = this.db.exec('SELECT DISTINCT file_path FROM embeddings');
    if (!result.length) return [];
    return result[0].values.map(row => row[0] as string);
  }

  getCount(): { total: number; byModality: Record<Modality, number> } {
    const totalResult = this.db.exec('SELECT COUNT(*) FROM embeddings');
    const total = totalResult.length ? (totalResult[0].values[0][0] as number) : 0;

    const byModalityResult = this.db.exec(
      'SELECT modality, COUNT(*) FROM embeddings GROUP BY modality'
    );
    const byModality: Record<string, number> = {};
    if (byModalityResult.length) {
      for (const row of byModalityResult[0].values) {
        byModality[row[0] as string] = row[1] as number;
      }
    }

    return { total, byModality: byModality as Record<Modality, number> };
  }

  clearAll(): void {
    this.db.run('DELETE FROM embeddings');
    this.persist();
  }

  // Write in-memory DB back to disk
  private persist(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}
