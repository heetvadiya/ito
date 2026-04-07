import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { EmbeddingRecord, Modality } from './types';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS embeddings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT    NOT NULL,
    file_hash       TEXT    NOT NULL,
    modality        TEXT    NOT NULL,
    chunk_index     INTEGER NOT NULL DEFAULT 0,
    embedding       BLOB    NOT NULL,
    summary         TEXT,
    file_size_bytes INTEGER,
    duration_seconds REAL,
    indexed_at      INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunk
    ON embeddings(file_path, chunk_index);

  CREATE INDEX IF NOT EXISTS idx_file_path
    ON embeddings(file_path);
`;

function encodeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function decodeEmbedding(buffer: Buffer): number[] {
  return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4));
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
  private readonly db: Database.Database;

  constructor(pluginDir: string) {
    mkdirSync(pluginDir, { recursive: true });
    this.db = new Database(join(pluginDir, 'ito.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  upsert(record: EmbeddingRecord): void {
    this.db.prepare(`
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
    `).run(
      record.filePath,
      record.fileHash,
      record.modality,
      record.chunkIndex,
      encodeEmbedding(record.embedding),
      record.summary ?? null,
      record.fileSizeBytes ?? null,
      record.durationSeconds ?? null,
      Date.now(),
    );
  }

  deleteFile(filePath: string): void {
    this.db.prepare('DELETE FROM embeddings WHERE file_path = ?').run(filePath);
  }

  // All chunks are renamed atomically inside a single transaction
  renameFile(oldPath: string, newPath: string): void {
    this.db.prepare(
      'UPDATE embeddings SET file_path = ? WHERE file_path = ?'
    ).run(newPath, oldPath);
  }

  getHash(filePath: string): string | null {
    const row = this.db.prepare(
      'SELECT file_hash FROM embeddings WHERE file_path = ? LIMIT 1'
    ).get(filePath) as { file_hash: string } | undefined;
    return row?.file_hash ?? null;
  }

  // Returns every stored embedding for query-time similarity computation
  getAllEmbeddings(): StoredEmbedding[] {
    const rows = this.db.prepare(`
      SELECT file_path, modality, chunk_index, embedding,
             summary, file_size_bytes, duration_seconds
      FROM embeddings
    `).all() as Array<{
      file_path: string;
      modality: string;
      chunk_index: number;
      embedding: Buffer;
      summary: string | null;
      file_size_bytes: number | null;
      duration_seconds: number | null;
    }>;

    return rows.map(r => ({
      filePath: r.file_path,
      modality: r.modality as Modality,
      chunkIndex: r.chunk_index,
      embedding: decodeEmbedding(r.embedding),
      summary: r.summary ?? undefined,
      fileSizeBytes: r.file_size_bytes ?? undefined,
      durationSeconds: r.duration_seconds ?? undefined,
    }));
  }

  getAllPaths(): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT file_path FROM embeddings'
    ).all() as Array<{ file_path: string }>;
    return rows.map(r => r.file_path);
  }

  getCount(): { total: number; byModality: Record<Modality, number> } {
    const total = (this.db.prepare(
      'SELECT COUNT(*) as n FROM embeddings'
    ).get() as { n: number }).n;

    const byModalityRows = this.db.prepare(
      'SELECT modality, COUNT(*) as n FROM embeddings GROUP BY modality'
    ).all() as Array<{ modality: string; n: number }>;

    const byModality: Record<string, number> = {};
    for (const row of byModalityRows) byModality[row.modality] = row.n;

    return {
      total,
      byModality: byModality as Record<Modality, number>,
    };
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM embeddings').run();
  }

  close(): void {
    this.db.close();
  }
}
