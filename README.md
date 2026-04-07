# Ito 糸

*Thread. The invisible line between things that belong together.*

---

## What Ito Is

Ito is an Obsidian plugin that surfaces semantic connections across your vault — across notes, images, PDFs, audio recordings, and video — without you needing to tag, organise, or link anything in advance.

It uses Google's Gemini multimodal embedding model to map every file in your vault into a single unified semantic space. A voice memo, a scanned diagram, a markdown note, and a PDF paper can all be compared against each other. When you open a note, Ito quietly finds what belongs near it.

---

## The Ideology

**Ito does not decide. You do.**

Most AI tools for knowledge management delegate the act of connection to a language model. The model summarises your notes, generates links, writes your thinking for you. The connections it makes are not yours — they are the model's best guess at what you probably meant.

We believe this is the wrong direction.

The value of a personal knowledge base is not in the storage of information. It is in the *moment of recognition* — when you see two ideas next to each other and something clicks. That moment belongs to the human, not the model.

Ito's job is only to *resurface*. To bring back the forgotten thread. To place a voice memo you recorded six months ago next to the note you are writing today, and let you decide whether the connection is real.

The model finds candidates. You confirm connections.

---

## Ito as a Knowledge Base & Retrieval Tool

Ito is not just a sidebar panel. It is the foundation of a two-part system for navigating your vault from anywhere — including inside an AI conversation.

### The setup

**1. Ito plugin** (this) — indexes your vault, keeps a live `vault-graph.json` in your vault root  
**2. [ito-cli](https://github.com/heetvadiya/ito-cli)** — reads that file from any terminal

```bash
# Install the CLI
curl -O https://raw.githubusercontent.com/heetvadiya/ito-cli/main/ito.py

# Set your vault once
python3 ito.py --config-vault ~/obsidian/MyVault

# Add alias so it works everywhere
echo 'alias ito="python3 /path/to/ito.py"' >> ~/.bashrc
source ~/.bashrc

# Search your vault from anywhere
ito "developer experience"
ito "what do I know about embeddings"
```

### Use with Claude or any AI

Add this to your Claude system prompt or `CLAUDE.md` in any project:

```
When asked "what do I know about X" or "find my notes on X",
run: python3 /path/to/ito.py "X"
Answer from the output.
```

Now asking *"what do I know about knowledge management?"* makes Claude search your actual vault and answer from your own notes — not its training data.

`ito` outputs structured markdown — headers, paths, tags, links, and full note content. LLM-friendly by design. No parsing, no preprocessing. The model reads it directly.

---

Dark mode:
<img width="1576" height="959" alt="image" src="https://github.com/user-attachments/assets/05e19d26-a0e5-49da-9c2d-2f1a103fc4ee" />
Light mode:
<img width="1576" height="959" alt="image" src="https://github.com/user-attachments/assets/d1f3cb41-cfe7-4c2b-91a5-232006476159" />
Settings Panel:
<img width="1123" height="902" alt="image" src="https://github.com/user-attachments/assets/1db10f15-956f-48c7-93c0-a71fc291966a" />

## What Ito Does Not Do

- It does not generate text.
- It does not summarise your notes.
- It does not write links into your vault without your explicit action.
- It does not send your files to any server except the Gemini API embedding call, using your own API key against your own quota.
- It does not modify any file in your vault except appending to a `## Related` section when you explicitly click *Add link*.

Your vault stays exactly as you left it.

---

## Multimodal

Gemini Embedding maps text, images, audio, video, and PDFs into the same vector space. This means:

- A sketch you photographed can surface the note it belongs to.
- A voice memo from a walk can connect to the essay you wrote a week later.
- A PDF paper can relate to your handwritten notes on the same topic.
- An image embedded in one note will be indexed *as part of that note* — so results always surface the note itself, not the raw file.

All of this happens without transcription, without description generation, without any LLM pass over your content. The embedding model reads the raw signal directly.

---

## Features

### Semantic Panel
Open with `Ctrl+Shift+I`. A sidebar panel showing the top related files for whatever note you are currently reading. Results include a matched content snippet so you can see *why* a connection was suggested before deciding to act on it.

The similarity threshold slider re-filters results in real time without any API call — the panel works entirely from cached embeddings after the initial index.

### Find Similar to Selection
Highlight any text in a note and run *Ito: Find notes similar to selection* from the command palette. Embeds the selection on demand and opens a results modal.

### Vault Indexer
Runs silently in the background. On first load, reconciles the entire vault against the index. After that, re-indexes files when you save them. New files are picked up automatically.

Progress and any errors surface as Obsidian notices. Nothing happens invisibly.

### Add Link
One button in the panel adds `[[filename]]` to a `## Related` section at the bottom of your active note. That is the only moment Ito writes anything to a vault file — and only when you ask it to.

### Vault Graph Export
Ito automatically maintains a `vault-graph.json` file in your vault root. It contains every note's title, links, backlinks, tags, and a content summary — the same data Obsidian uses to render the graph view, exported as clean JSON.

The file refreshes automatically whenever:
- Obsidian opens
- Any note's links change
- A file finishes indexing

You can also trigger it manually: *Ito: Export vault graph* in the command palette.

This file is the bridge to **[ito-cli](https://github.com/heetvadiya/ito-cli)** — a companion command-line tool that lets you (or any AI) navigate your vault without opening Obsidian.

---

## Setup

### From the Community Plugin Directory *(pending review)*

1. Open Obsidian → **Settings → Community plugins → Browse**
2. Search for **Ito** and install
3. Enable the plugin
4. Go to **Settings → Ito**, paste your [Gemini API key](https://aistudio.google.com/app/apikey)
5. Click **Test connection** to verify
6. Ito will begin indexing your vault automatically

---

### Manual Install (available now)

**Requirements:** [Node.js](https://nodejs.org) 18+, [Git](https://git-scm.com)

```bash
# 1. Clone the repo
git clone https://github.com/heetvadiya/ito.git
cd ito

# 2. Install dependencies and build
npm install
npm run build
```

This produces `main.js` in the project root.

```bash
# 3. Copy the three plugin files into your vault
cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/ito/
```

Replace `/path/to/your/vault` with the actual path to your Obsidian vault. Create the `ito` folder if it doesn't exist.

4. Open Obsidian → **Settings → Community plugins** → disable Safe mode if prompted → enable **Ito**
5. Go to **Settings → Ito**, paste your [Gemini API key](https://aistudio.google.com/app/apikey)
6. Click **Test connection** to verify
7. Ito will begin indexing your vault automatically

**Model used:** `gemini-embedding-2-preview`  
**Supported files:** `.md`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`, `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.mp4`, `.mov`, `.webm`

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Gemini API key | — | Required. Never stored outside your vault's local data. |
| Indexed folders | *(entire vault)* | Comma-separated paths to scope indexing. |
| Embedding dimension | 768 | 768 / 1536 / 3072. Changing requires full re-index. |
| Similarity threshold | 75% | Minimum score for a result to appear. |
| Max results | 8 | Between 3 and 20. |
| Auto-index on save | On | Re-indexes a file when you save it. |
| Index audio files | On | MP3, WAV, M4A, OGG, FLAC. |
| Index video files | Off | MP4, MOV, WEBM. Opt-in — large files consume significant quota. |
| Max file size | 50 MB | Files larger than this are skipped silently. |

---

## Privacy

Ito sends file content to the Gemini API for embedding. This is the only external call the plugin makes. Everything else — the vector index, similarity computation, results ranking — runs locally inside Obsidian.

The index lives at `.obsidian/plugins/ito/ito.db`. It travels with your vault and belongs entirely to you.

---

## The Name

糸 — *Ito* — is Japanese for *thread*.

A thread is the connection before it becomes a knot. It is potential, not structure. Ito finds the threads. You decide which ones to tie.

---

*Built with intentionality. The connections are yours.*
