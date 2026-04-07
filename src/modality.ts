import { Modality, RateLimitClass, EmbedPayload } from './types';
import { extractExcerpt, formatFileSize, formatDuration } from './utils';

// Each modality encapsulates: how its content is encoded for the Gemini API,
// how its summary is represented, and its rate-limit class.
// Adding a new modality = one new class. Zero changes to indexer, panel, or modal.
export interface FileModality {
  readonly modality: Modality;
  rateLimitClass(): RateLimitClass;
  encode(buffer: ArrayBuffer, fileName: string): EmbedPayload;
  summarise(
    contentOrBuffer: string | ArrayBuffer,
    fileName: string,
    fileSizeBytes?: number,
    durationSeconds?: number,
  ): string;
}

export class NoteModality implements FileModality {
  readonly modality: Modality = 'text';
  rateLimitClass(): RateLimitClass { return 'light'; }

  encode(buffer: ArrayBuffer): EmbedPayload {
    const text = new TextDecoder().decode(buffer);
    return { type: 'text', content: text };
  }

  summarise(content: string | ArrayBuffer): string {
    const text = typeof content === 'string'
      ? content
      : new TextDecoder().decode(content);
    return extractExcerpt(text);
  }
}

export class ImageModality implements FileModality {
  readonly modality: Modality = 'image';
  rateLimitClass(): RateLimitClass { return 'light'; }

  encode(buffer: ArrayBuffer, fileName: string): EmbedPayload {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpeg';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
    };
    return {
      type: 'inline',
      mimeType: mimeMap[ext] ?? 'image/jpeg',
      base64: Buffer.from(buffer).toString('base64'),
    };
  }

  summarise(_: string | ArrayBuffer, fileName: string): string {
    return fileName;
  }
}

export class PDFModality implements FileModality {
  readonly modality: Modality = 'pdf';
  rateLimitClass(): RateLimitClass { return 'light'; }

  encode(buffer: ArrayBuffer): EmbedPayload {
    return {
      type: 'inline',
      mimeType: 'application/pdf',
      base64: Buffer.from(buffer).toString('base64'),
    };
  }

  summarise(_: string | ArrayBuffer, fileName: string): string {
    return fileName;
  }
}

export class AudioModality implements FileModality {
  readonly modality: Modality = 'audio';
  rateLimitClass(): RateLimitClass { return 'heavy'; }

  encode(buffer: ArrayBuffer, fileName: string): EmbedPayload {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? 'mp3';
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    };
    return {
      type: 'inline',
      mimeType: mimeMap[ext] ?? 'audio/mpeg',
      base64: Buffer.from(buffer).toString('base64'),
    };
  }

  summarise(
    _: string | ArrayBuffer,
    fileName: string,
    fileSizeBytes?: number,
    durationSeconds?: number,
  ): string {
    const parts = [fileName];
    if (fileSizeBytes != null) parts.push(formatFileSize(fileSizeBytes));
    if (durationSeconds != null) parts.push(formatDuration(durationSeconds));
    return parts.join(' · ');
  }
}

export class VideoModality implements FileModality {
  readonly modality: Modality = 'video';
  rateLimitClass(): RateLimitClass { return 'heavy'; }

  encode(buffer: ArrayBuffer, fileName: string): EmbedPayload {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? 'mp4';
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
    };
    return {
      type: 'inline',
      mimeType: mimeMap[ext] ?? 'video/mp4',
      base64: Buffer.from(buffer).toString('base64'),
    };
  }

  summarise(
    _: string | ArrayBuffer,
    fileName: string,
    fileSizeBytes?: number,
    durationSeconds?: number,
  ): string {
    const parts = [fileName];
    if (fileSizeBytes != null) parts.push(formatFileSize(fileSizeBytes));
    if (durationSeconds != null) parts.push(formatDuration(durationSeconds));
    return parts.join(' · ');
  }
}

// Registry maps file extensions to their modality handler.
// Returns null for unsupported extensions — callers skip silently.
const REGISTRY: ReadonlyMap<string, FileModality> = new Map<string, FileModality>([
  ['.md',   new NoteModality()],
  ['.txt',  new NoteModality()],
  ['.png',  new ImageModality()],
  ['.jpg',  new ImageModality()],
  ['.jpeg', new ImageModality()],
  ['.webp', new ImageModality()],
  ['.pdf',  new PDFModality()],
  ['.mp3',  new AudioModality()],
  ['.wav',  new AudioModality()],
  ['.m4a',  new AudioModality()],
  ['.ogg',  new AudioModality()],
  ['.flac', new AudioModality()],
  ['.mp4',  new VideoModality()],
  ['.mov',  new VideoModality()],
  ['.webm', new VideoModality()],
]);

export const ModalityRegistry = {
  get(filePath: string): FileModality | null {
    const ext = '.' + (filePath.split('.').pop()?.toLowerCase() ?? '');
    return REGISTRY.get(ext) ?? null;
  },
};
