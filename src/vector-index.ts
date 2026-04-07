import { Neighbor, Modality } from './types';
import { ItoStore } from './store';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class ItoVectorIndex {
  constructor(private readonly store: ItoStore) {}

  query(
    origin: number[],
    threshold: number,
    limit: number,
    excludePath: string,
  ): Neighbor[] {
    const all = this.store.getAllEmbeddings();

    // Score every chunk, then keep only the best chunk per file
    const bestPerFile = new Map<string, Neighbor>();

    for (const record of all) {
      if (record.filePath === excludePath) continue;

      const similarity = cosineSimilarity(origin, record.embedding);
      if (similarity < threshold) continue;

      const existing = bestPerFile.get(record.filePath);
      if (!existing || similarity > existing.similarity) {
        bestPerFile.set(record.filePath, {
          filePath: record.filePath,
          modality: record.modality as Modality,
          similarity,
          summary: record.summary,
          fileSizeBytes: record.fileSizeBytes,
          durationSeconds: record.durationSeconds,
          chunkIndex: record.chunkIndex,
        });
      }
    }

    return Array.from(bestPerFile.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}
