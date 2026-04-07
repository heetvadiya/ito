export type Modality = 'text' | 'image' | 'pdf' | 'audio' | 'video';

export type RateLimitClass = 'light' | 'heavy';

export type EmbeddingDimension = 768 | 1536 | 3072;

export type FileIndexState =
  | 'unindexed'
  | 'queued'
  | 'indexed'
  | 'stale'
  | 'failed'
  | 'skipped';

export interface EmbedPayload {
  type: 'text';
  content: string;
} | {
  type: 'inline';
  mimeType: string;
  base64: string;
}

export interface EmbeddingRecord {
  filePath: string;
  fileHash: string;
  modality: Modality;
  chunkIndex: number;
  embedding: number[];
  summary?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
}

export interface Neighbor {
  filePath: string;
  modality: Modality;
  similarity: number;
  summary?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  chunkIndex: number;
}

export interface IndexPolicy {
  geminiApiKey: string;
  indexedFolders: string[];
  similarityThreshold: number;
  maxResults: number;
  embeddingDimension: EmbeddingDimension;
  autoIndexOnSave: boolean;
  indexAudio: boolean;
  indexVideo: boolean;
  maxFileSizeMb: number;
}

export const DEFAULT_INDEX_POLICY: IndexPolicy = {
  geminiApiKey: '',
  indexedFolders: [],
  similarityThreshold: 0.75,
  maxResults: 8,
  embeddingDimension: 768,
  autoIndexOnSave: true,
  indexAudio: true,
  indexVideo: false,
  maxFileSizeMb: 50,
};

// Typed error classes — no string matching at call sites
export class ItoAuthError extends Error {
  constructor() {
    super('Invalid Gemini API key. Check Ito settings.');
    this.name = 'ItoAuthError';
  }
}

export class ItoQuotaError extends Error {
  constructor() {
    super('Gemini API quota exceeded. Indexing paused.');
    this.name = 'ItoQuotaError';
  }
}

export class ItoFileTooLargeError extends Error {
  constructor(public readonly filePath: string) {
    super(`FILE_TOO_LARGE: ${filePath}`);
    this.name = 'ItoFileTooLargeError';
  }
}

export class ItoNetworkError extends Error {
  constructor() {
    super('NETWORK_ERROR');
    this.name = 'ItoNetworkError';
  }
}
