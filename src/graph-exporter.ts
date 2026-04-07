import { App, TFile } from 'obsidian';
import { ItoStore } from './store';

interface GraphNode {
  title: string;
  links: string[];
  backlinks: string[];
  tags: string[];
  summary?: string;
  modality?: string;
  wordCount?: number;
}

interface VaultGraph {
  $meta: {
    vault: string;
    generated: string;
    totalNotes: number;
  };
  nodes: Record<string, GraphNode>;
}

const OUTPUT_PATH = 'vault-graph.json';
const DEBOUNCE_MS = 2000;

export class GraphExporter {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly app: App,
    private readonly store: ItoStore,
  ) {}

  // Schedule a debounced export — multiple rapid changes collapse into one write
  scheduleExport(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.export();
      this.debounceTimer = null;
    }, DEBOUNCE_MS);
  }

  async export(): Promise<void> {
    const { metadataCache, vault } = this.app;

    // Build backlinks by inverting resolvedLinks
    const backlinks: Record<string, string[]> = {};
    const resolvedLinks = metadataCache.resolvedLinks;

    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      for (const targetPath of Object.keys(targets)) {
        if (!backlinks[targetPath]) backlinks[targetPath] = [];
        if (!backlinks[targetPath].includes(sourcePath)) {
          backlinks[targetPath].push(sourcePath);
        }
      }
    }

    // Pull summaries from the vector store (already indexed)
    const summaryMap: Record<string, { summary?: string; modality?: string }> = {};
    for (const record of this.store.getAllEmbeddings()) {
      if (record.chunkIndex === 0) {
        summaryMap[record.filePath] = {
          summary: record.summary,
          modality: record.modality,
        };
      }
    }

    // Build nodes
    const nodes: Record<string, GraphNode> = {};
    const files = vault.getMarkdownFiles();

    for (const file of files) {
      const cache = metadataCache.getFileCache(file);
      const tags = cache?.tags?.map(t => t.tag) ??
                   cache?.frontmatter?.tags ?? [];

      const links = Object.keys(resolvedLinks[file.path] ?? {});
      const stored = summaryMap[file.path];

      // Word count from cache frontmatter or estimate from file size
      const wordCount = cache?.frontmatter?.wordCount
        ?? Math.round(file.stat.size / 5);

      nodes[file.path] = {
        title: file.basename,
        links,
        backlinks: backlinks[file.path] ?? [],
        tags: Array.isArray(tags) ? tags : [],
        summary: stored?.summary,
        modality: stored?.modality,
        wordCount,
      };
    }

    const graph: VaultGraph = {
      $meta: {
        vault: vault.getName(),
        generated: new Date().toISOString(),
        totalNotes: files.length,
      },
      nodes,
    };

    const json = JSON.stringify(graph, null, 2);

    // Write or overwrite vault-graph.json in vault root
    const existing = vault.getFileByPath(OUTPUT_PATH);
    if (existing) {
      await vault.modify(existing, json);
    } else {
      await vault.create(OUTPUT_PATH, json);
    }
  }
}
