import { App, Notice, TFile } from 'obsidian';
import { ItoStore } from './store';
import { ItoEmbedder } from './embedder';
import { ModalityRegistry } from './modality';
import { IndexPolicy, ItoAuthError, ItoFileTooLargeError, ItoNetworkError, ItoQuotaError } from './types';
import { chunkMarkdown, computeHash, extractEmbeddedImagePaths, sleep } from './utils';

export const RATE_LIMIT_MS_LIGHT = 300;
export const RATE_LIMIT_MS_HEAVY = 600;

export type IndexerEvent =
  | { type: 'file-indexed'; filePath: string }
  | { type: 'indexing-paused' }
  | { type: 'auth-error' }
  | { type: 'progress'; current: number; total: number; counts: ModalityCounts };

export interface ModalityCounts {
  notes: number;
  images: number;
  pdfs: number;
  audio: number;
  video: number;
}

type EventListener = (event: IndexerEvent) => void;

export class ItoIndexer {
  private queue: TFile[] = [];
  private isProcessing = false;
  private isPaused = false;
  private retryPaths: Set<string> = new Set();
  private listeners: EventListener[] = [];

  constructor(
    private readonly app: App,
    private readonly store: ItoStore,
    private readonly embedder: ItoEmbedder,
    private readonly getPolicy: () => IndexPolicy,
  ) {}

  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(event: IndexerEvent): void {
    for (const l of this.listeners) l(event);
  }

  enqueue(file: TFile): void {
    if (this.isPaused) return;
    if (!this.shouldIndex(file)) return;
    if (!this.queue.find(f => f.path === file.path)) {
      this.queue.push(file);
    }
    if (!this.isProcessing) this.processQueue();
  }

  async indexFile(file: TFile): Promise<void> {
    const policy = this.getPolicy();
    if (!this.shouldIndex(file)) return;

    const modality = ModalityRegistry.get(file.path);
    if (!modality) return;

    const buffer = await this.app.vault.readBinary(file);
    const hash = computeHash(buffer);

    if (this.store.getHash(file.path) === hash) return;

    if (modality.modality === 'text') {
      const content = new TextDecoder().decode(buffer);
      const chunks = chunkMarkdown(content);
      this.store.deleteFile(file.path);

      // Resolve images embedded in this note
      const embeddedRefs = extractEmbeddedImagePaths(content);
      const resolvedImages = await this.resolveImages(file.path, embeddedRefs);

      // Register these image paths so they're skipped when encountered as standalone files
      for (const ref of embeddedRefs) {
        const resolved = this.resolveImagePath(file.path, ref);
        if (resolved) this.embeddedImagePaths.add(resolved);
      }

      for (let i = 0; i < chunks.length; i++) {
        // Images only attached to the first chunk to keep subsequent chunks light
        const chunkImages = i === 0 ? resolvedImages : [];
        const chunkPayload = chunkImages.length > 0
          ? { type: 'composite' as const, textContent: chunks[i], images: chunkImages }
          : { type: 'text' as const, content: chunks[i] };

        const vector = await this.embedder.embed(chunkPayload);
        const summary = modality.summarise(chunks[i], file.name);
        this.store.upsert({
          filePath: file.path,
          fileHash: hash,
          modality: modality.modality,
          chunkIndex: i,
          embedding: vector,
          summary,
          fileSizeBytes: file.stat.size,
        });
        if (i < chunks.length - 1) await sleep(RATE_LIMIT_MS_LIGHT);
      }
    } else {
      // Skip images that are already embedded inside a note
      if (modality.modality === 'image' && this.embeddedImagePaths.has(file.path)) {
        console.log(`Ito: skipping standalone index of ${file.path} — embedded in a note`);
        return;
      }

      const payload = modality.encode(buffer, file.name);
      const vector = await this.embedder.embed(payload);
      const summary = modality.summarise(buffer, file.name, file.stat.size, undefined);
      this.store.upsert({
        filePath: file.path,
        fileHash: hash,
        modality: modality.modality,
        chunkIndex: 0,
        embedding: vector,
        summary,
        fileSizeBytes: file.stat.size,
      });
    }

    this.emit({ type: 'file-indexed', filePath: file.path });
  }

  removeFile(file: TFile): void {
    this.store.deleteFile(file.path);
    this.queue = this.queue.filter(f => f.path !== file.path);
  }

  renameFile(oldPath: string, newFile: TFile): void {
    this.store.renameFile(oldPath, newFile.path);
  }

  // Paths of images that are embedded inside markdown notes.
  // These are indexed as part of their parent note, not as standalone files.
  private embeddedImagePaths = new Set<string>();

  async reconcile(): Promise<void> {
    const policy = this.getPolicy();
    const vaultFiles = this.app.vault.getFiles().filter(f => this.shouldIndex(f));
    const indexedPaths = new Set(this.store.getAllPaths());

    // Remove DB entries for files no longer in the vault
    for (const path of indexedPaths) {
      if (!this.app.vault.getFileByPath(path)) {
        this.store.deleteFile(path);
      }
    }

    // Determine files that need indexing
    const toIndex: TFile[] = [];
    for (const file of vaultFiles) {
      const storedHash = this.store.getHash(file.path);
      if (!storedHash) {
        toIndex.push(file);
      } else {
        // Stale check — read binary to compute hash
        const buffer = await this.app.vault.readBinary(file);
        if (computeHash(buffer) !== storedHash) toIndex.push(file);
      }
    }

    const total = toIndex.length;
    const counts: ModalityCounts = { notes: 0, images: 0, pdfs: 0, audio: 0, video: 0 };
    let current = 0;

    for (const file of toIndex) {
      if (this.isPaused) break;

      try {
        await this.indexFile(file);
        current++;
        this.tallyCount(file, counts);
        this.emit({ type: 'progress', current, total, counts });

        const modality = ModalityRegistry.get(file.path);
        const delay = modality?.rateLimitClass() === 'heavy'
          ? RATE_LIMIT_MS_HEAVY
          : RATE_LIMIT_MS_LIGHT;
        await sleep(delay);

        new Notice(
          `Ito: indexing ${current} of ${total} files ` +
          `(notes: ${counts.notes}, images: ${counts.images}, ` +
          `pdfs: ${counts.pdfs}, audio: ${counts.audio}, video: ${counts.video})...`,
          2000,
        );
      } catch (err) {
        this.handleError(err, file.path);
        if (this.isPaused) break;
      }
    }
  }

  async reindexAll(): Promise<void> {
    this.store.clearAll();
    this.isPaused = false;
    await this.reconcile();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isPaused) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && !this.isPaused) {
      const file = this.queue.shift()!;
      const modality = ModalityRegistry.get(file.path);

      try {
        await this.indexFile(file);
        const name = file.path.split('/').pop() ?? file.path;
        new Notice(`Ito: indexed ${name}`, 2500);
        const delay = modality?.rateLimitClass() === 'heavy'
          ? RATE_LIMIT_MS_HEAVY
          : RATE_LIMIT_MS_LIGHT;
        await sleep(delay);
      } catch (err) {
        this.handleError(err, file.path);
      }
    }

    this.isProcessing = false;
  }

  private handleError(err: unknown, filePath: string): void {
    if (err instanceof ItoAuthError) {
      new Notice('Ito: invalid API key. Check settings.');
      this.isPaused = true;
      this.emit({ type: 'auth-error' });
      return;
    }
    if (err instanceof ItoQuotaError) {
      new Notice('Ito: Gemini quota reached. Indexing paused — will retry on next vault open.');
      this.isPaused = true;
      this.retryPaths.add(filePath);
      this.emit({ type: 'indexing-paused' });
      return;
    }
    if (err instanceof ItoFileTooLargeError) {
      console.log(`Ito: skipped ${filePath} — exceeds size limit`);
      return;
    }
    if (err instanceof ItoNetworkError) {
      this.retryPaths.add(filePath);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    new Notice(`Ito: error indexing ${filePath.split('/').pop()} — ${msg}`);
    console.error(`Ito: unexpected error indexing ${filePath}`, err);
  }

  // Resolve an image reference from a note to an absolute vault path
  private resolveImagePath(notePath: string, imageRef: string): string | null {
    // If it's already an absolute-looking path, use as-is
    if (!imageRef.includes('/')) {
      // Bare filename — search vault for it
      const found = this.app.vault.getFiles().find(f => f.name === imageRef);
      return found?.path ?? null;
    }
    // Relative path — resolve from note's folder
    const noteDir = notePath.split('/').slice(0, -1).join('/');
    const resolved = noteDir ? `${noteDir}/${imageRef}` : imageRef;
    return this.app.vault.getFileByPath(resolved)?.path ?? null;
  }

  // Load image files referenced in a note and return base64-encoded payloads
  private async resolveImages(
    notePath: string,
    refs: string[],
  ): Promise<Array<{ mimeType: string; base64: string }>> {
    const results: Array<{ mimeType: string; base64: string }> = [];
    for (const ref of refs) {
      const resolvedPath = this.resolveImagePath(notePath, ref);
      if (!resolvedPath) continue;

      const imageFile = this.app.vault.getFileByPath(resolvedPath);
      if (!imageFile) continue;

      const imgModality = ModalityRegistry.get(resolvedPath);
      if (!imgModality || imgModality.modality !== 'image') continue;

      try {
        const imgBuffer = await this.app.vault.readBinary(imageFile);
        const payload = imgModality.encode(imgBuffer, imageFile.name);
        if (payload.type === 'inline') {
          results.push({ mimeType: payload.mimeType, base64: payload.base64 });
        }
      } catch {
        console.log(`Ito: could not load embedded image ${resolvedPath}`);
      }
    }
    return results;
  }

  private shouldIndex(file: TFile): boolean {
    const policy = this.getPolicy();
    const modality = ModalityRegistry.get(file.path);
    if (!modality) return false;

    if (modality.modality === 'audio' && !policy.indexAudio) return false;
    if (modality.modality === 'video' && !policy.indexVideo) return false;

    const sizeMb = file.stat.size / (1024 * 1024);
    if (sizeMb > policy.maxFileSizeMb) return false;

    if (policy.indexedFolders.length > 0) {
      return policy.indexedFolders.some(folder =>
        file.path.startsWith(folder.endsWith('/') ? folder : folder + '/')
      );
    }

    return true;
  }

  private tallyCount(file: TFile, counts: ModalityCounts): void {
    const m = ModalityRegistry.get(file.path);
    if (!m) return;
    if (m.modality === 'text')  counts.notes++;
    if (m.modality === 'image') counts.images++;
    if (m.modality === 'pdf')   counts.pdfs++;
    if (m.modality === 'audio') counts.audio++;
    if (m.modality === 'video') counts.video++;
  }
}
