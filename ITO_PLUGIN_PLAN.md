# Ito (糸) — Obsidian Plugin
## PRD + Full Build Plan for Claude Code

---

## Instructions for Claude Code

Read this entire document before writing a single line of code. Build in the exact order specified in the Implementation Plan section. After completing each file, stop and confirm before moving to the next. Do not invent features not listed here. Do not refactor across files unless explicitly asked.

---

## 1. What Ito Is

Ito (糸) is Japanese for "thread." It is an Obsidian community plugin that uses Google's Gemini Embedding 2 natively multimodal embedding model to surface semantic connections across a user's vault — across notes, images, PDFs, audio files, and video files — without the user needing to manually tag, organise, or link anything.

Ito never writes to the user's vault files. It never generates text. It never summarises. It reads files, embeds them, stores vectors locally, and surfaces pointers back to the user's original content. The vault stays exactly as the user left it.

The user's intentional `[[wikilinks]]` are theirs. Ito only suggests. The user decides what becomes a permanent link.

---

## 2. Core Design Principles

**Read-only on vault files.** Ito never modifies any file in the vault. The only file it writes is its own SQLite database at `.obsidian/plugins/ito/ito.db`.

**Local-first.** The vector index lives inside the vault. It travels with the vault, syncs with it, and belongs to the user. Nothing is sent to any server except the Gemini API call for embedding, using the user's own API key against their own quota.

**No noise.** Ito does not generate text, summaries, or articles. It surfaces filenames, excerpts from the user's own content, similarity scores, and modality labels. That is all.

**Passive by default.** Ito runs silently in the background. The user summons it with a keyboard shortcut. It does not auto-open panels, interrupt writing, or show persistent UI elements unless the user wants it.

**Intentional links win.** Ito's suggestions are dotted lines. The user's confirmed `[[wikilinks]]` are solid lines. These are different things and the system treats them differently.

---

## 3. Supported Modalities

| Modality | Extensions | Gemini handling |
|---|---|---|
| Text | .md, .txt | Text embedding, chunked at headings |
| Image | .png, .jpg, .jpeg, .webp | Native image embedding, base64 |
| PDF | .pdf | Native PDF embedding, base64, max 6 pages |
| Audio | .mp3, .wav, .m4a, .ogg, .flac | Native audio embedding, no transcription needed |
| Video | .mp4, .mov, .webm | Native video embedding, max 120 seconds |

All five modalities are embedded into the same unified vector space by Gemini Embedding 2. A voice memo, a PDF, an image, and a markdown note can all be semantically compared against each other with cosine similarity.

---

## 4. Features (v0.1 scope — build only these)

### 4.1 Settings

A settings tab in Obsidian's settings panel with the following fields:

- **Gemini API key** — password input, masked, required for any functionality
- **Indexed folders** — text input, comma-separated folder paths, empty means entire vault
- **Embedding dimension** — dropdown: 768 (fast, cheap), 1536 (balanced), 3072 (best quality). Default 768. Changing this requires a full reindex.
- **Similarity threshold** — slider, 0.50 to 1.00, default 0.75, step 0.01
- **Max results** — number input, default 8, range 3–20
- **Auto-index on save** — toggle, default on
- **Index audio files** — toggle, default on
- **Index video files** — toggle, default off (opt-in because of file sizes and API costs)
- **Max file size to index** — number input in MB, default 50
- **Re-index vault** — button, triggers full wipe and reindex with progress notice
- **Clear index** — button, wipes DB with confirmation modal, does not re-index

Show a cost warning in the settings tab beneath the embedding dimension selector:
> "Audio and video files consume significantly more API quota than text files. Monitor your Gemini API usage dashboard during initial indexing."

### 4.2 Vault Indexer

A background pipeline that:

1. On plugin load, runs a reconciliation pass — compares all files in the vault against the DB, indexes new files, removes DB entries for deleted files, re-indexes changed files (by MD5 hash comparison)
2. On `vault.on('create')` — indexes the new file
3. On `vault.on('modify')` — checks hash, re-indexes only if content actually changed
4. On `vault.on('delete')` — removes the file's entries from the DB
5. On `vault.on('rename')` — updates the file path in the DB

During initial index shows a progress notice: `Ito: indexing 23 of 340 files (notes: 18, images: 3, pdfs: 1, audio: 1, video: 0)...`

Rate limiting between API calls: 300ms for text and images, 600ms for audio and video. Expose these as constants `RATE_LIMIT_MS_LIGHT` and `RATE_LIMIT_MS_HEAVY`.

### 4.3 Semantic Panel

Activated by keyboard shortcut (default `Ctrl+Shift+I`, configurable). Toggles a right sidebar panel open and closed.

When open and a file is active, the panel shows:

- Panel header: "Ito — related" with a small refresh icon button
- Similarity threshold slider (0.50–1.00) that re-filters the cached result set in real time without any API call
- Result list, each item showing:
  - File name (clickable, opens the file)
  - Modality badge: Note / Image / PDF / Audio / Video
  - Similarity percentage (e.g. "87%")
  - Excerpt: for text/pdf — first 120 characters of the matching chunk. For audio/video — filename + file size + duration (e.g. "voice-note.m4a · 4.2 MB · 3 min"). For images — filename + dimensions if available.
  - "Add as backlink" button — appends `[[filename]]` to a `## Related` section at the bottom of the currently active note. Creates the section if it does not exist. This is the only moment Ito writes anything to a vault file.

Empty state: "No related files found. Try lowering the threshold."
Loading state: "Finding threads..."
No API key state: "Add your Gemini API key in Ito settings to get started."

Panel refreshes when:
- Active file changes
- User clicks the refresh icon
- A file finishes indexing (indexer emits an event)
- Similarity slider moves (re-filters cached results, no API call)

### 4.4 Find Similar to Selection Command

Command palette entry: `Ito: find notes similar to selection`

1. User highlights any text in a note
2. Runs the command
3. Ito embeds the selected text via Gemini API
4. Opens a modal showing top matches from across the vault
5. Each result in the modal is clickable to open the file
6. Modal has a "Add as backlink" button per result

Validation: if selection is fewer than 10 characters, show Notice: "Select at least a sentence to search."

### 4.5 Reindex Command

Command palette entry: `Ito: rebuild index from scratch`

Wipes the DB and re-indexes the entire vault from scratch. Shows progress notice. Required after changing embedding dimension in settings.

---

## 5. File Structure

```
ito/
├── src/
│   ├── main.ts          # Plugin entry point
│   ├── settings.ts      # Settings schema + settings tab UI
│   ├── indexer.ts       # File watcher + embedding pipeline
│   ├── embedder.ts      # Gemini API calls per modality
│   ├── store.ts         # SQLite read/write + cosine similarity
│   ├── panel.ts         # Semantic backlinks sidebar panel
│   ├── modal.ts         # Results modal for find-similar command
│   └── utils.ts         # Hash, file type detection, chunking, duration
├── manifest.json
├── package.json
├── tsconfig.json
└── esbuild.config.mjs
```

---

## 6. manifest.json

```json
{
  "id": "ito",
  "name": "Ito",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "Surfaces semantic connections across your notes, images, PDFs, audio, and video using multimodal AI embeddings. Your vault, understood.",
  "author": "Heet",
  "authorUrl": "https://github.com/yourusername",
  "isDesktopOnly": true
}
```

---

## 7. package.json

```json
{
  "name": "obsidian-ito",
  "version": "0.1.0",
  "description": "Multimodal semantic search for Obsidian",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "better-sqlite3": "^9.4.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20.0.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.20.0",
    "obsidian": "latest",
    "typescript": "^5.0.0"
  }
}
```

---

## 8. tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2018",
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "importHelpers": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "lib": ["ES2018", "DOM"]
  },
  "include": ["src/**/*.ts"]
}
```

---

## 9. esbuild.config.mjs

```javascript
import esbuild from 'esbuild';
import { builtinModules } from 'builtin-modules';

const prod = process.argv[2] === 'production';

esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
}).catch(() => process.exit(1));
```

---

## 10. Detailed Implementation — store.ts

### SQLite schema

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  modality TEXT NOT NULL,
  chunk_index INTEGER DEFAULT 0,
  embedding BLOB NOT NULL,
  excerpt TEXT,
  file_size_bytes INTEGER,
  duration_seconds REAL,
  indexed_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunk
  ON embeddings(file_path, chunk_index);

CREATE INDEX IF NOT EXISTS idx_file_path
  ON embeddings(file_path);
```

DB file location: `{vault}/.obsidian/plugins/ito/ito.db`

### Types

```typescript
type Modality = 'text' | 'image' | 'pdf' | 'audio' | 'video';

interface EmbeddingRecord {
  filePath: string;
  fileHash: string;
  modality: Modality;
  chunkIndex: number;
  embedding: number[];
  excerpt?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
}

interface SimilarFile {
  filePath: string;
  modality: Modality;
  similarity: number;
  excerpt?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  chunkIndex: number;
}
```

### Cosine similarity

```typescript
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
```

### Store class interface

```typescript
class ItoStore {
  constructor(pluginDir: string)
  
  upsert(record: EmbeddingRecord): void
  // Insert or replace. Store embedding as Float32Array buffer.

  deleteFile(filePath: string): void
  // Remove all chunks for this file path.

  renameFile(oldPath: string, newPath: string): void
  // Update file_path for all chunks of this file.

  getHash(filePath: string): string | null
  // Return stored MD5 hash or null if not indexed.

  query(queryVector: number[], topK: number, excludePath: string, threshold: number): SimilarFile[]
  // Load all embeddings from DB. Compute cosine similarity in JS.
  // Deduplicate by file — keep only the highest-scoring chunk per file.
  // Filter by threshold. Sort descending. Return top topK.

  getAllPaths(): string[]
  // All unique file paths currently in the index.

  getCount(): { total: number; byModality: Record<Modality, number> }
  // For progress display.

  close(): void
  // Close DB connection cleanly on plugin unload.
}
```

Note on embedding storage: store as `Buffer.from(new Float32Array(embedding).buffer)`. Retrieve with `Array.from(new Float32Array(buffer.buffer))`.

---

## 11. Detailed Implementation — embedder.ts

### Model name

Use model: `gemini-embedding-exp-03-07`

Verify the correct model string at https://ai.google.dev/gemini-api/docs/embeddings before building. It may have been updated. If a newer stable model string exists for Gemini Embedding 2 multimodal, use that instead.

### Output dimension

Pass `outputDimensionality` matching the user's settings (768, 1536, or 3072).

### Methods

```typescript
class ItoEmbedder {
  constructor(apiKey: string, dimension: number)

  async embedText(content: string): Promise<number[]>
  // Use taskType: 'RETRIEVAL_DOCUMENT'

  async embedImage(base64Data: string, mimeType: 'image/png' | 'image/jpeg' | 'image/webp'): Promise<number[]>
  // Inline data part with mimeType and base64

  async embedPdf(base64Data: string): Promise<number[]>
  // Inline data part with mimeType 'application/pdf' and base64

  async embedAudio(base64Data: string, mimeType: string): Promise<number[]>
  // Inline data part with audio mimeType and base64

  async embedVideo(base64Data: string, mimeType: string): Promise<number[]>
  // Inline data part with video mimeType and base64

  updateApiKey(newKey: string): void
  updateDimension(newDim: number): void
}
```

### Error handling in embedder

- 401 — throw with message "Invalid Gemini API key. Check Ito settings."
- 429 — throw with message "Gemini API quota exceeded. Indexing paused." Caller handles retry.
- 400 with "file too large" — throw with message "FILE_TOO_LARGE" so indexer can skip gracefully.
- Network failure — throw with message "NETWORK_ERROR" so indexer can queue for retry.

---

## 12. Detailed Implementation — utils.ts

### Supported file types

```typescript
const MODALITY_MAP: Record<string, Modality> = {
  '.md':   'text',
  '.txt':  'text',
  '.png':  'image',
  '.jpg':  'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.pdf':  'pdf',
  '.mp3':  'audio',
  '.wav':  'audio',
  '.m4a':  'audio',
  '.ogg':  'audio',
  '.flac': 'audio',
  '.mp4':  'video',
  '.mov':  'video',
  '.webm': 'video',
};

function getModality(filePath: string): Modality | null
// Returns null for unsupported extensions — indexer skips these silently.
```

### File hash

```typescript
import { createHash } from 'crypto';

function computeHash(buffer: ArrayBuffer): string {
  return createHash('md5').update(Buffer.from(buffer)).digest('hex');
}
```

### Text chunking

```typescript
function chunkMarkdown(content: string): string[]
// 1. Split at heading boundaries (## and ###)
// 2. If any chunk exceeds 6000 characters, split further at double newlines
// 3. Return array of chunks, minimum 100 characters each (skip tiny fragments)
// 4. Maximum 20 chunks per file (truncate beyond that, log a warning)
```

### Excerpt extraction

```typescript
function extractExcerpt(content: string, maxLength = 120): string
// Strip markdown syntax (links, bold, italic, headers)
// Return first maxLength characters of clean text
// Trim at word boundary
```

### Duration formatting

```typescript
function formatDuration(seconds: number): string
// 65 -> "1 min 5 sec"
// 180 -> "3 min"
// 45 -> "45 sec"
```

### File size formatting

```typescript
function formatFileSize(bytes: number): string
// 1024 -> "1.0 KB"
// 1048576 -> "1.0 MB"
// 52428800 -> "50.0 MB"
```

---

## 13. Detailed Implementation — settings.ts

### Schema

```typescript
interface ItoSettings {
  geminiApiKey: string;
  indexedFolders: string[];
  similarityThreshold: number;
  maxResults: number;
  embeddingDimension: 768 | 1536 | 3072;
  autoIndexOnSave: boolean;
  indexAudio: boolean;
  indexVideo: boolean;
  maxFileSizeMb: number;
}

const DEFAULT_SETTINGS: ItoSettings = {
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
```

### Settings tab

Extend `PluginSettingTab`. Build UI with Obsidian's `Setting` API. Items in order:

1. API key — `addText`, input type password, placeholder "Paste Gemini API key"
2. Indexed folders — `addText`, placeholder "folder1, folder2 (empty = entire vault)"
3. Embedding dimension — `addDropdown` with options 768/1536/3072, description "Changing dimension requires re-indexing your vault"
4. Cost warning — plain text description element, amber/warning color
5. Similarity threshold — `addSlider` min 50 max 100 step 1, display as percentage
6. Max results — `addText` type number
7. Auto-index on save — `addToggle`
8. Index audio files — `addToggle`
9. Index video files — `addToggle`
10. Max file size — `addText` type number, suffix "MB"
11. Re-index vault — `addButton` text "Re-index entire vault", calls `plugin.indexer.reindexAll()`
12. Clear index — `addButton` text "Clear index", opens confirmation modal, calls `plugin.store.clearAll()` on confirm

---

## 14. Detailed Implementation — indexer.ts

```typescript
class ItoIndexer {
  private queue: TFile[] = [];
  private isProcessing = false;

  constructor(
    private app: App,
    private store: ItoStore,
    private embedder: ItoEmbedder,
    private settings: ItoSettings,
    private onFileIndexed: () => void  // callback to refresh panel
  )

  async reconcile(): Promise<void>
  // Compare vault files against DB.
  // Index files in vault but not in DB.
  // Remove DB entries for files no longer in vault.
  // Re-index files whose hash has changed.
  // Show progress notice during this pass.

  async indexFile(file: TFile): Promise<void>
  // Check file extension — skip if unsupported modality
  // Check modality toggles (indexAudio, indexVideo) — skip if disabled
  // Check file size — skip with Notice if over maxFileSizeMb
  // Read file as ArrayBuffer
  // Compute hash — skip if hash matches stored hash
  // Route to correct embed method based on modality
  // For text: chunk, embed each chunk, store all chunks
  // For others: embed as single unit, store
  // On success: call onFileIndexed()
  // On error: log to console, show Notice for quota/auth errors

  async removeFile(file: TFile): Promise<void>
  // store.deleteFile(file.path)

  async renameFile(oldPath: string, newFile: TFile): Promise<void>
  // store.renameFile(oldPath, newFile.path)

  async reindexAll(onProgress: (current: number, total: number, counts: object) => void): Promise<void>
  // store.clearAll()
  // Get all files in vault
  // Filter to supported types + settings toggles
  // Index each with rate limiting
  // Call onProgress after each file

  private async processQueue(): Promise<void>
  // Drain the queue with rate limiting
  // RATE_LIMIT_MS_LIGHT = 300 for text/image/pdf
  // RATE_LIMIT_MS_HEAVY = 600 for audio/video

  private shouldIndex(file: TFile): boolean
  // Check extension, modality toggles, file size, indexed folders scope
}
```

### Text embedding flow specifically

```typescript
// Inside indexFile for text modality:
const content = await this.app.vault.read(file);
const chunks = chunkMarkdown(content);
this.store.deleteFile(file.path);  // remove old chunks first
for (let i = 0; i < chunks.length; i++) {
  const vector = await this.embedder.embedText(chunks[i]);
  this.store.upsert({
    filePath: file.path,
    fileHash: hash,
    modality: 'text',
    chunkIndex: i,
    embedding: vector,
    excerpt: extractExcerpt(chunks[i]),
  });
  if (i < chunks.length - 1) await sleep(RATE_LIMIT_MS_LIGHT);
}
```

### PDF page limit handling

```typescript
// Before embedding PDF:
// Gemini supports max 6 pages. We cannot check page count without parsing.
// Attempt embed. If API returns error indicating file too large, show Notice:
new Notice(`Ito: ${file.name} may exceed 6 pages. Embedding first portion only.`);
// Do not skip — attempt anyway and let Gemini truncate or error.
```

---

## 15. Detailed Implementation — panel.ts

```typescript
class ItoPanel extends ItemView {
  static VIEW_TYPE = 'ito-panel';

  private cachedResults: SimilarFile[] = [];
  private currentFilePath: string | null = null;

  getViewType(): string { return ItoPanel.VIEW_TYPE; }
  getDisplayText(): string { return 'Ito'; }
  getIcon(): string { return 'git-branch'; }

  async onOpen(): Promise<void>
  // Build panel DOM structure
  // Register active-leaf-change listener
  // Initial refresh if a file is already open

  async refresh(file: TFile): Promise<void>
  // Show loading state
  // Get embedding for current file from store (don't re-embed — use stored vector)
  // Call store.query() with current threshold and maxResults
  // Cache results in this.cachedResults
  // Render results

  private renderResults(results: SimilarFile[], threshold: number): void
  // Filter cachedResults by threshold
  // Render each as a result row
  // Handle empty state

  private renderResultRow(result: SimilarFile): HTMLElement
  // File name as clickable link: this.app.workspace.openLinkText()
  // Modality badge
  // Similarity as percentage: Math.round(result.similarity * 100) + '%'
  // Excerpt or media info
  // "Add as backlink" button

  private async addBacklink(targetFilePath: string): Promise<void>
  // Get currently active file
  // Read its content
  // Check if ## Related section exists
  // If yes: append [[targetFilePath]] to it
  // If no: append \n\n## Related\n\n[[targetFilePath]] to end of file
  // vault.modify() to save
  // Show Notice: "Ito: link added to Related section"

  private getModalityLabel(modality: Modality): string
  // 'text' -> 'Note'
  // 'image' -> 'Image'
  // 'pdf' -> 'PDF'
  // 'audio' -> 'Audio'
  // 'video' -> 'Video'

  private getMediaInfo(result: SimilarFile): string
  // For audio/video: formatFileSize(bytes) + ' · ' + formatDuration(seconds)
  // For image: just filename
  // For text/pdf: excerpt
}
```

### Important note on getting the current file's vector

When the panel refreshes for a file, do NOT re-call the Gemini API. Retrieve the stored embedding for that file from the DB and use it as the query vector. For text files with multiple chunks, use chunk 0 (the top of the file). This means panel refresh is instant and costs zero API calls.

---

## 16. Detailed Implementation — modal.ts

```typescript
class ItoResultsModal extends Modal {
  constructor(
    app: App,
    private results: SimilarFile[],
    private onAddBacklink: (path: string) => Promise<void>
  )

  onOpen(): void
  // Title: "Ito — similar content"
  // Render results list same as panel result rows
  // Each result: file name (clickable, closes modal and opens file), modality badge, similarity %, excerpt, Add as backlink button

  onClose(): void
  // Clean up
}
```

---

## 17. Detailed Implementation — main.ts

```typescript
export default class ItoPlugin extends Plugin {
  settings: ItoSettings;
  store: ItoStore;
  embedder: ItoEmbedder;
  indexer: ItoIndexer;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Init store
    const pluginDir = `${this.app.vault.configDir}/plugins/ito`;
    this.store = new ItoStore(pluginDir);

    // Init embedder
    this.embedder = new ItoEmbedder(
      this.settings.geminiApiKey,
      this.settings.embeddingDimension
    );

    // Init indexer
    this.indexer = new ItoIndexer(
      this.app,
      this.store,
      this.embedder,
      this.settings,
      () => this.refreshPanel()
    );

    // Register panel view
    this.registerView(
      ItoPanel.VIEW_TYPE,
      (leaf) => new ItoPanel(leaf, this)
    );

    // Ribbon icon
    this.addRibbonIcon('git-branch', 'Ito — related files', () => {
      this.togglePanel();
    });

    // Settings tab
    this.addSettingTab(new ItoSettingTab(this.app, this));

    // Vault events
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile) this.indexer.indexFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.settings.autoIndexOnSave) {
          this.indexer.indexFile(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) this.indexer.removeFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) this.indexer.renameFile(oldPath, file);
      })
    );

    // Active file change -> refresh panel
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.refreshPanel();
      })
    );

    // Commands
    this.addCommand({
      id: 'toggle-panel',
      name: 'Toggle related files panel',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'I' }],
      callback: () => this.togglePanel(),
    });

    this.addCommand({
      id: 'find-similar-to-selection',
      name: 'Find notes similar to selection',
      editorCallback: async (editor: Editor) => {
        const selected = editor.getSelection().trim();
        if (selected.length < 10) {
          new Notice('Ito: select at least a sentence to search.');
          return;
        }
        if (!this.settings.geminiApiKey) {
          new Notice('Ito: add your Gemini API key in settings first.');
          return;
        }
        const notice = new Notice('Ito: finding similar content...', 0);
        try {
          const vector = await this.embedder.embedText(selected);
          const results = this.store.query(
            vector,
            this.settings.maxResults,
            this.app.workspace.getActiveFile()?.path ?? '',
            this.settings.similarityThreshold
          );
          notice.hide();
          new ItoResultsModal(
            this.app,
            results,
            (path) => this.addBacklinkToCurrentFile(path)
          ).open();
        } catch (e) {
          notice.hide();
          new Notice(`Ito: ${e.message}`);
        }
      },
    });

    this.addCommand({
      id: 'reindex-vault',
      name: 'Rebuild index from scratch',
      callback: () => {
        this.indexer.reindexAll((current, total, counts) => {
          // Progress handled inside reindexAll via Notice
        });
      },
    });

    // Run reconciliation after layout ready
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.geminiApiKey) {
        this.indexer.reconcile();
      }
    });
  }

  async onunload(): Promise<void> {
    this.store.close();
  }

  private async togglePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(ItoPanel.VIEW_TYPE);
    if (existing.length > 0) {
      existing[0].detach();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: ItoPanel.VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private refreshPanel(): void {
    const panels = this.app.workspace.getLeavesOfType(ItoPanel.VIEW_TYPE);
    const activeFile = this.app.workspace.getActiveFile();
    if (panels.length > 0 && activeFile) {
      (panels[0].view as ItoPanel).refresh(activeFile);
    }
  }

  private async addBacklinkToCurrentFile(targetPath: string): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;
    const content = await this.app.vault.read(activeFile);
    const targetName = targetPath.replace(/\.md$/, '');
    const linkText = `[[${targetName}]]`;
    let newContent: string;
    if (content.includes('## Related')) {
      newContent = content + `\n${linkText}`;
    } else {
      newContent = content + `\n\n## Related\n\n${linkText}`;
    }
    await this.app.vault.modify(activeFile, newContent);
    new Notice(`Ito: link added to Related section.`);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

---

## 18. Error Handling Rules

Apply these consistently across all files:

| Error type | Behaviour |
|---|---|
| No API key | Show persistent Notice with text "Ito: add your Gemini API key in settings." Do not attempt any API call. |
| 401 Unauthorized | Show Notice "Ito: invalid API key. Check settings." Stop indexing. |
| 429 Quota exceeded | Show Notice "Ito: Gemini quota reached. Indexing paused — will retry on next vault open." Stop current indexing run. |
| File too large | Skip file silently. Log to console: `Ito: skipped [path] — exceeds size limit`. |
| PDF over 6 pages | Attempt embed anyway. Show one Notice per oversized file. |
| Video over 120s | Show Notice once per file: "Ito: [filename] exceeds 120s limit. Only first 120s embedded." |
| Network error | Skip file, add to retry queue, retry on next plugin load. |
| DB corruption | Catch SQLite errors, show Notice "Ito: index error. Try clearing and rebuilding the index in settings." |

---

## 19. Implementation Order for Claude Code

Build in this exact order. Complete and confirm each file before starting the next.

1. `package.json` + `tsconfig.json` + `esbuild.config.mjs` + `manifest.json`
2. `src/utils.ts` — no dependencies on other src files
3. `src/store.ts` — depends on utils.ts types only
4. `src/embedder.ts` — depends on utils.ts types only
5. `src/settings.ts` — depends on all of the above for types
6. `src/modal.ts` — depends on store.ts types
7. `src/panel.ts` — depends on store.ts, utils.ts, modal.ts
8. `src/indexer.ts` — depends on store.ts, embedder.ts, utils.ts
9. `src/main.ts` — depends on everything above

---

## 20. First Sanity Check (do this before building panel or indexer)

Before any UI work, verify the embedding pipeline end to end with a standalone test script:

```typescript
// test-embed.ts (not part of the plugin, run with ts-node)
import { ItoEmbedder } from './src/embedder';

const embedder = new ItoEmbedder('YOUR_API_KEY_HERE', 768);

async function test() {
  const v1 = await embedder.embedText('the quick brown fox jumps over the lazy dog');
  const v2 = await embedder.embedText('a fast auburn canine leaps above a sleepy hound');

  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    nA  += v1[i] * v1[i];
    nB  += v2[i] * v2[i];
  }
  const similarity = dot / (Math.sqrt(nA) * Math.sqrt(nB));
  console.log('Similarity:', similarity.toFixed(4));
  console.log('Expected: above 0.85');
  console.log(similarity > 0.85 ? 'PASS' : 'FAIL');
}

test().catch(console.error);
```

If this passes, the embedding pipeline works. Everything else is plumbing around it.

---

## 21. What Success Looks Like for v0.1

- User installs plugin, enters API key, vault begins indexing automatically
- Initial index completes with progress notice
- User opens any note, presses `Ctrl+Shift+I`, panel opens showing related files
- Results include notes, images, PDFs, audio, and video files mixed together
- Similarity slider filters results in real time without any API call
- User clicks "Add as backlink" on a result — `[[filename]]` appears in Related section of current note
- User highlights text, runs "Find similar to selection" command — modal opens with results
- User saves a file — it re-indexes automatically in the background
- User adds a new PDF — it appears in the index within seconds

---

## 22. Out of Scope for v0.1

Do not build these. They are future work.

- Graph view overlay
- Whisper transcription for audio/video
- Local embedding via Ollama
- CLI tool or MCP server
- Semantic search bar
- Any form of LLM-generated text, summaries, or articles
- Cloud sync of the vector index
- Any UI triggered by typing `[[`
- Floating footer panel

---

*End of document. Build Ito.*
