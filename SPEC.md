# Spec: Ito (糸) — Multimodal Semantic Search for Obsidian

## Overview

Ito surfaces semantic connections across a user's Obsidian vault — across notes, images, PDFs, audio, and video — using Google Gemini multimodal embeddings. It never writes to vault files (except appending to a `## Related` section on explicit user request), never generates text, and never summarises. It reads, embeds, stores locally, and surfaces pointers.

---

## Walking Skeleton — Slice 0: Project Scaffold + Sanity Check

*The thinnest possible end-to-end path. Proves the embedding pipeline works before building any UI.*

### Acceptance Criteria

- [ ] `npm run build` completes without TypeScript errors
- [ ] `npm run dev` starts esbuild in watch mode
- [ ] `manifest.json`, `package.json`, `tsconfig.json`, `esbuild.config.mjs` are present and valid
- [ ] A standalone `test-embed.ts` script can be run with `ts-node`
- [ ] The test script embeds two semantically similar sentences and produces a cosine similarity above 0.85
- [ ] The test script embeds two unrelated sentences and produces a cosine similarity below 0.60
- [ ] The embedding vector length matches the configured dimension (768, 1536, or 3072)

### Out of Scope
- No Obsidian plugin loaded in this slice — pure Node.js script only
- No database, no UI, no vault events

### Technical Context
- Model: `gemini-embedding-exp-03-07` (verify at https://ai.google.dev/gemini-api/docs/embeddings)
- Risk: **LOW**

---

## Slice 1: Core Domain Types

*No runtime code. Shared contracts that all other slices depend on.*

### Acceptance Criteria

- [ ] `FileModality` interface is defined with methods: `encode(buffer: ArrayBuffer): EmbedPayload`, `summarise(content: string | ArrayBuffer): string`, `rateLimitClass(): 'light' | 'heavy'`
- [ ] `FileIndexState` enum covers: `Unindexed`, `Queued`, `Indexed`, `Stale`, `Failed`, `Skipped`
- [ ] `EmbeddingRecord` type includes: `filePath`, `fileHash`, `modality`, `chunkIndex`, `embedding`, `summary`, `fileSizeBytes`, `durationSeconds`
- [ ] `Neighbor` type includes: `filePath`, `modality`, `similarity`, `summary`, `chunkIndex`
- [ ] `IndexPolicy` interface includes all user-configurable settings (API key, folders, dimension, threshold, maxResults, autoIndex, indexAudio, indexVideo, maxFileSizeMb)
- [ ] `DEFAULT_INDEX_POLICY` constant provides safe defaults (threshold: 0.75, maxResults: 8, dimension: 768, autoIndex: true, indexAudio: true, indexVideo: false, maxFileSizeMb: 50)
- [ ] All types compile with `strict: true` and `noImplicitAny: true`
- [ ] No implementation logic exists in this slice — interfaces and types only

### Out of Scope
- No class implementations
- No SQLite, no API calls, no Obsidian imports

### Technical Context
- Risk: **LOW**

---

## Slice 2: ModalityRegistry — File Type Routing

*Replaces all `if modality === 'text'` conditional chains with a type-safe registry.*

### Acceptance Criteria

- [ ] `ModalityRegistry.get('.md')` returns a `NoteModality` instance
- [ ] `ModalityRegistry.get('.txt')` returns a `NoteModality` instance
- [ ] `ModalityRegistry.get('.png')` returns an `ImageModality` instance
- [ ] `ModalityRegistry.get('.jpg')`, `.jpeg`, `.webp` return `ImageModality`
- [ ] `ModalityRegistry.get('.pdf')` returns a `PDFModality` instance
- [ ] `ModalityRegistry.get('.mp3')`, `.wav`, `.m4a`, `.ogg`, `.flac` return `AudioModality`
- [ ] `ModalityRegistry.get('.mp4')`, `.mov`, `.webm` return `VideoModality`
- [ ] `ModalityRegistry.get('.xyz')` returns `null` — indexer will skip silently
- [ ] `NoteModality.rateLimitClass()` returns `'light'`
- [ ] `ImageModality.rateLimitClass()` returns `'light'`
- [ ] `PDFModality.rateLimitClass()` returns `'light'`
- [ ] `AudioModality.rateLimitClass()` returns `'heavy'`
- [ ] `VideoModality.rateLimitClass()` returns `'heavy'`
- [ ] `NoteModality.summarise()` strips markdown syntax (links, bold, italic, headers) and returns first 120 characters trimmed at a word boundary
- [ ] `AudioModality.summarise()` returns `"${filename} · ${formattedSize} · ${formattedDuration}"`
- [ ] `VideoModality.summarise()` returns `"${filename} · ${formattedSize} · ${formattedDuration}"`
- [ ] `ImageModality.summarise()` returns the filename

### Helper Functions (part of this slice)

- [ ] `formatDuration(65)` returns `"1 min 5 sec"`
- [ ] `formatDuration(180)` returns `"3 min"`
- [ ] `formatDuration(45)` returns `"45 sec"`
- [ ] `formatFileSize(1024)` returns `"1.0 KB"`
- [ ] `formatFileSize(1048576)` returns `"1.0 MB"`
- [ ] `computeHash(buffer)` returns a hex MD5 string of consistent length

### Text Chunking (part of this slice)

- [ ] `chunkMarkdown` splits content at `##` and `###` heading boundaries
- [ ] Any chunk exceeding 6000 characters is split further at double newlines
- [ ] Chunks shorter than 100 characters are discarded
- [ ] Output is capped at 20 chunks per file
- [ ] A file with no headings is returned as a single chunk

### Out of Scope
- No Gemini API calls in this slice — encoding methods return typed payloads, not vectors
- No Obsidian vault reads

### Technical Context
- Risk: **LOW**

---

## Slice 3: VectorStore — Persistence

*SQLite-backed storage for embeddings. No query/similarity logic here — that lives in Slice 4.*

### Acceptance Criteria

- [ ] `ItoStore` creates the SQLite database at `{pluginDir}/ito.db` on construction
- [ ] Database schema is created if it does not exist (idempotent)
- [ ] `upsert(record)` stores a new embedding row or replaces an existing one for the same `(filePath, chunkIndex)` pair
- [ ] Embeddings are stored as `Float32Array` binary buffers, not JSON arrays
- [ ] `getHash(filePath)` returns the stored MD5 hash for a known file
- [ ] `getHash(filePath)` returns `null` for a path not in the index
- [ ] `deleteFile(filePath)` removes all chunk rows for that path
- [ ] `renameFile(oldPath, newPath)` updates `file_path` for all chunks atomically (single transaction)
- [ ] `getAllPaths()` returns an array of unique file paths currently indexed
- [ ] `getCount()` returns `{ total: number, byModality: Record<Modality, number> }`
- [ ] `clearAll()` removes all rows from the embeddings table
- [ ] `close()` closes the database connection without error
- [ ] A second `ItoStore` instance pointing to the same path can read records written by the first

### Out of Scope
- No cosine similarity computation (Slice 4)
- No Obsidian API imports

### Technical Context
- Embedding retrieval format: `Array.from(new Float32Array(buffer.buffer))`
- Risk: **MODERATE** (data integrity — rename must be atomic)

---

## Slice 4: VectorIndex — Semantic Query

*Loads embeddings from the store and finds nearest neighbors by cosine similarity.*

### Acceptance Criteria

- [ ] `VectorIndex.query(origin, threshold, limit, excludePath)` returns `Neighbor[]`
- [ ] Results are sorted by similarity descending
- [ ] Only one result per file is returned — the chunk with the highest similarity score
- [ ] Files below the threshold are excluded from results
- [ ] `excludePath` file is never included in results (prevents a note matching itself)
- [ ] Result count does not exceed `limit`
- [ ] `query` with an empty index returns `[]`
- [ ] `query` with threshold `1.0` returns only exact matches (cosine similarity = 1.0)
- [ ] `query` with threshold `0.0` returns all indexed files up to `limit`
- [ ] Two vectors for semantically similar sentences (from Slice 0 test) produce similarity > 0.85
- [ ] Cosine similarity of a vector with itself is 1.0 (within floating-point precision)
- [ ] Cosine similarity of two zero vectors returns 0 (no division by zero)

### Out of Scope
- No API calls — operates purely on stored embeddings
- No Obsidian imports

### Technical Context
- This is a full in-memory scan — acceptable for vaults up to ~50k files at 768 dimensions
- Risk: **LOW**

---

## Slice 5: ItoEmbedder — Gemini API Client

*Thin client that calls Gemini. All modality-specific encoding is delegated to `FileModality` objects from Slice 2.*

### Acceptance Criteria

- [ ] `ItoEmbedder.embed(payload: EmbedPayload, dimension: number)` returns `number[]`
- [ ] Task type `RETRIEVAL_DOCUMENT` is used for all embedding calls
- [ ] `outputDimensionality` is passed as the configured dimension (768, 1536, or 3072)
- [ ] A 401 response throws an error with message `"Invalid Gemini API key. Check Ito settings."`
- [ ] A 429 response throws an error with message `"Gemini API quota exceeded. Indexing paused."`
- [ ] A 400 response containing "file too large" throws an error with message `"FILE_TOO_LARGE"`
- [ ] A network failure throws an error with message `"NETWORK_ERROR"`
- [ ] `updateApiKey(newKey)` updates the key used for subsequent calls without creating a new instance
- [ ] `updateDimension(newDim)` updates the output dimension without creating a new instance

### Out of Scope
- Retry logic — the caller (IndexQueue in Slice 6) handles retries
- No database or vault interactions

### Technical Context
- `@google/generative-ai` SDK, model `gemini-embedding-exp-03-07`
- Risk: **MODERATE** (external API, error classification must be precise)

---

## Slice 6: IndexQueue + VaultReconciler — Indexing Pipeline

*Processes files through the embedding pipeline with rate limiting, hash deduplication, and state tracking.*

### Acceptance Criteria

**IndexQueue:**
- [ ] `enqueue(file)` adds a file to the processing queue
- [ ] Files with modality `rateLimitClass() === 'light'` wait 300ms between API calls
- [ ] Files with modality `rateLimitClass() === 'heavy'` wait 600ms between API calls
- [ ] If the stored hash matches the computed hash, the file is skipped — no API call is made
- [ ] After a successful embed, `onFileIndexed` callback is invoked
- [ ] A `FILE_TOO_LARGE` error marks the file as `Skipped` and logs to console — no Notice shown
- [ ] A `NETWORK_ERROR` marks the file as `Failed` and adds it to a retry list
- [ ] A 429 quota error marks the file as `Failed`, emits an `IndexingPaused` event, and stops the queue
- [ ] A 401 auth error marks the file as `Failed`, emits an `AuthError` event, and stops the queue
- [ ] Files with unsupported extensions are silently skipped — no queue entry created
- [ ] Files exceeding `maxFileSizeMb` are silently skipped — no queue entry created, logged to console
- [ ] Files in modalities disabled by `IndexPolicy` (audio/video toggles) are silently skipped

**Text file indexing specifically:**
- [ ] A markdown file is chunked before embedding
- [ ] Each chunk is embedded and stored as a separate row with `chunkIndex` 0, 1, 2…
- [ ] Old chunks for the file are deleted from the store before new chunks are written
- [ ] Each chunk waits `RATE_LIMIT_MS_LIGHT` before the next embed call

**VaultReconciler:**
- [ ] On `reconcile()`, files present in the vault but absent from the index are enqueued
- [ ] On `reconcile()`, index entries for files no longer in the vault are deleted
- [ ] On `reconcile()`, files whose hash has changed since last index are re-enqueued
- [ ] A progress Notice updates during reconciliation: `"Ito: indexing 23 of 340 files (notes: 18, images: 3, pdfs: 1, audio: 1, video: 0)..."`
- [ ] Reconciliation only runs when a Gemini API key is configured

**Folder scoping:**
- [ ] When `indexedFolders` is non-empty, only files under those paths are enqueued
- [ ] When `indexedFolders` is empty, the entire vault is in scope

### Out of Scope
- Vault event wiring (Slice 8 — main.ts)
- UI rendering

### Technical Context
- `RATE_LIMIT_MS_LIGHT = 300`, `RATE_LIMIT_MS_HEAVY = 600` as exported constants
- Risk: **HIGH** (queue correctness, hash deduplication, state transitions, quota handling)

---

## Slice 7: IndexPolicy + Settings UI

*User-configurable preferences. The Settings UI emits change events — it does not call indexer or store directly.*

### Acceptance Criteria

**IndexPolicy:**
- [ ] `IndexPolicy` is loaded from Obsidian's `loadData()` on plugin start, merged with `DEFAULT_INDEX_POLICY`
- [ ] `IndexPolicy` is persisted via `saveData()` on any settings change
- [ ] All components (IndexQueue, VaultReconciler, SemanticPanel) read from the shared `IndexPolicy` instance

**Settings Tab UI:**
- [ ] API key field renders as a password input (masked characters)
- [ ] API key placeholder text reads `"Paste Gemini API key"`
- [ ] Indexed folders field accepts comma-separated paths; empty string means entire vault
- [ ] Embedding dimension dropdown shows three options: 768, 1536, 3072
- [ ] A cost warning renders beneath the dimension selector
- [ ] Similarity threshold renders as a slider from 50 to 100, displayed as a percentage
- [ ] Max results field accepts a number between 3 and 20
- [ ] Auto-index on save renders as a toggle
- [ ] Index audio files renders as a toggle
- [ ] Index video files renders as a toggle
- [ ] Max file size field accepts a number with "MB" suffix label
- [ ] "Re-index entire vault" button triggers a `ReindexRequested` event (does not call indexer directly)
- [ ] "Clear index" button opens a confirmation modal before proceeding
- [ ] "Clear index" on confirmation triggers a `ClearIndexRequested` event (does not call store directly)
- [ ] Changing the embedding dimension triggers a `DimensionChanged` event

### Out of Scope
- No cost calculation or quota estimation UI
- Risk: **LOW**

---

## Slice 8: SemanticPanel — Related Files Sidebar

*The primary user-facing surface. Displays the active file's Neighborhood.*

### Acceptance Criteria

**Panel lifecycle:**
- [ ] Panel opens to the right sidebar when `Ctrl+Shift+I` is pressed
- [ ] Pressing `Ctrl+Shift+I` again closes the panel
- [ ] Panel header reads `"Ito — related"` with a refresh icon button
- [ ] Panel registers for `active-leaf-change` and refreshes when the active file changes

**Loading & empty states:**
- [ ] While querying, panel displays `"Finding threads..."`
- [ ] When no results meet the threshold, panel displays `"No related files found. Try lowering the threshold."`
- [ ] When no API key is configured, panel displays `"Add your Gemini API key in Ito settings to get started."`
- [ ] When the active file has not been indexed yet, panel displays the loading state and waits for indexing to complete

**Neighborhood display:**
- [ ] Panel uses the active file's **stored** embedding as the query origin — no Gemini API call on refresh
- [ ] For text files with multiple chunks, chunk 0 is used as the query origin
- [ ] Each result row shows: file name (clickable), modality badge, similarity percentage rounded to nearest integer
- [ ] Clicking a file name opens that file in the editor
- [ ] Text/PDF results show the stored excerpt (first 120 chars of clean text)
- [ ] Audio/Video results show `"filename · size · duration"` (e.g. `"voice-note.m4a · 4.2 MB · 3 min"`)
- [ ] Image results show the filename

**Threshold slider:**
- [ ] Similarity threshold slider re-filters the cached Neighborhood without calling `VectorIndex`
- [ ] Slider range is 0.50 to 1.00, step 0.01
- [ ] Moving the slider never triggers a Gemini API call

**Add as backlink:**
- [ ] "Add as backlink" button appends `[[filename]]` to a `## Related` section in the active note
- [ ] If no `## Related` section exists, one is created at the end of the note before appending
- [ ] Existing note content above `## Related` is never modified
- [ ] A Notice confirms: `"Ito: link added to Related section."`
- [ ] "Add as backlink" only acts on the currently active file — not the result file

**Refresh triggers:**
- [ ] Panel refreshes when active file changes
- [ ] Panel refreshes when the refresh icon is clicked
- [ ] Panel refreshes when the IndexQueue emits a `FileIndexed` event for the active file

### Out of Scope
- Deduplication of backlinks already present in `## Related`
- Risk: **MODERATE**

---

## Slice 9: ResultsModal — Find Similar to Selection

*Command palette feature for ad-hoc semantic search on selected text.*

### Acceptance Criteria

- [ ] Command `"Ito: find notes similar to selection"` appears in Obsidian's command palette
- [ ] Invoking the command with fewer than 10 characters selected shows Notice: `"Ito: select at least a sentence to search."`
- [ ] Invoking the command with no API key shows Notice: `"Ito: add your Gemini API key in settings first."`
- [ ] While embedding the selection, a persistent Notice displays `"Ito: finding similar content..."`
- [ ] The persistent Notice is hidden before the modal opens
- [ ] Modal title reads `"Ito — similar content"`
- [ ] Modal result rows show the same format as SemanticPanel result rows (file name, modality badge, similarity %, excerpt)
- [ ] Clicking a file name in the modal closes the modal and opens the file
- [ ] "Add as backlink" in the modal appends `[[filename]]` to the active note's Related section
- [ ] If the Gemini API call fails, the persistent Notice is hidden and an error Notice is shown

### Out of Scope
- History of previous selection queries
- Risk: **LOW**

---

## Slice 10: Main Orchestration + Vault Events

*Wires all components. The plugin entry point.*

### Acceptance Criteria

**Startup:**
- [ ] Plugin loads without throwing when no API key is configured
- [ ] `ItoStore` is initialized at `{vault}/.obsidian/plugins/ito/ito.db`
- [ ] `VaultReconciler.reconcile()` is called after `workspace.onLayoutReady()`
- [ ] Reconciliation is skipped if no API key is configured
- [ ] A ribbon icon with `git-branch` icon and tooltip `"Ito — related files"` is registered

**Vault events:**
- [ ] `vault.on('create')` enqueues the new file in IndexQueue
- [ ] `vault.on('modify')` enqueues the file only when `autoIndexOnSave` is enabled
- [ ] `vault.on('delete')` calls `store.deleteFile(file.path)`
- [ ] `vault.on('rename')` calls `store.renameFile(oldPath, file.path)`

**Commands:**
- [ ] `"Ito: Toggle related files panel"` is registered with hotkey `Ctrl+Shift+I`
- [ ] `"Ito: Find notes similar to selection"` is registered in the command palette
- [ ] `"Ito: Rebuild index from scratch"` is registered in the command palette

**Settings wiring:**
- [ ] `DimensionChanged` event triggers `IndexQueue` to clear the store and run a full reconcile
- [ ] `ReindexRequested` event triggers full wipe + reconcile with progress Notice
- [ ] `ClearIndexRequested` event calls `store.clearAll()` with no subsequent reconcile

**Shutdown:**
- [ ] `store.close()` is called in `onunload()`
- [ ] No unhandled promise rejections on unload

**Error handling:**
- [ ] `AuthError` event shows Notice: `"Ito: invalid API key. Check settings."` and stops indexing
- [ ] `IndexingPaused` event shows Notice: `"Ito: Gemini quota reached. Indexing paused — will retry on next vault open."`

### Out of Scope
- Retry-on-reload for failed files (tracked as future work)
- Risk: **HIGH** (event wiring, state coordination, clean shutdown)

---

## Full Out of Scope (v0.1)

- Graph view overlay showing semantic connections
- Whisper-based transcription for audio/video files
- Local embedding via Ollama or any model running on device
- Semantic search bar or fuzzy-match UI triggered by typing
- LLM-generated summaries, articles, or any text generation
- Cloud sync of the vector index
- UI triggered by typing `[[`
- Floating footer panel
- Deduplication of backlinks already in `## Related`
- Retry-on-reload for `Failed` files (they remain in `Failed` state until user triggers reindex)
- CLI tool, MCP server, or any interface outside of Obsidian

---

## Build Order

Slices can be built in this dependency order. Items at the same level are independently buildable in parallel:

```
Level 0 (no deps):  Slice 0 (sanity check), Slice 1 (types)
Level 1:            Slice 2 (modalities), Slice 7 (settings) — depend on Slice 1
Level 2:            Slice 3 (store), Slice 5 (embedder) — depend on Slices 1 + 2
Level 3:            Slice 4 (vector index) — depends on Slice 3
Level 4:            Slice 6 (indexing pipeline) — depends on Slices 2 + 3 + 5
Level 5:            Slice 8 (panel), Slice 9 (modal) — depend on Slices 3 + 4; can stub Slice 6
Level 6:            Slice 10 (main) — depends on everything
```

---

## Risk Summary

| Slice | Name | Risk |
|-------|------|------|
| 0 | Sanity Check | LOW |
| 1 | Core Types | LOW |
| 2 | ModalityRegistry | LOW |
| 3 | VectorStore | MODERATE |
| 4 | VectorIndex | LOW |
| 5 | Embedder | MODERATE |
| 6 | IndexingPipeline | **HIGH** |
| 7 | Settings | LOW |
| 8 | SemanticPanel | MODERATE |
| 9 | ResultsModal | LOW |
| 10 | Main Orchestration | **HIGH** |

Start integration testing at Slice 6 and Slice 10 — those are where defects are most expensive.
