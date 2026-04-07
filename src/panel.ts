import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { Neighbor } from './types';
import type ItoPlugin from './main';

export const ITO_PANEL_VIEW_TYPE = 'ito-panel';

// RelatedCollection encapsulates the "find or create ## Related section" logic.
// Panel and modal call append() — neither contains the string manipulation.
class RelatedCollection {
  constructor(private content: string) {}

  append(wikiLink: string): string {
    const link = `[[${wikiLink}]]`;
    if (this.content.includes('## Related')) {
      return this.content + `\n${link}`;
    }
    return this.content + `\n\n## Related\n\n${link}`;
  }
}

export class ItoPanel extends ItemView {
  private cachedNeighbors: Neighbor[] = [];
  private currentFilePath: string | null = null;
  private contentEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ItoPlugin) {
    super(leaf);
  }

  getViewType(): string { return ITO_PANEL_VIEW_TYPE; }
  getDisplayText(): string { return 'Ito'; }
  getIcon(): string { return 'git-branch'; }

  async onOpen(): Promise<void> {
    this.contentEl = this.containerEl.children[1] as HTMLElement;
    this.contentEl.empty();
    this.contentEl.addClass('ito-panel');
    this.renderEmpty('Open a note to see related files.');

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const file = this.app.workspace.getActiveFile();
        if (file) this.refresh(file);
      })
    );

    const file = this.app.workspace.getActiveFile();
    if (file) this.refresh(file);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async refresh(file: TFile): Promise<void> {
    if (!this.plugin.settings.geminiApiKey) {
      this.renderState('no-key', 'Add your Gemini API key in Ito settings to get started.');
      return;
    }

    this.currentFilePath = file.path;
    this.renderState('loading', 'Finding threads…');

    // Use stored embedding — never re-call Gemini on panel refresh
    const allEmbeddings = this.plugin.store.getAllEmbeddings();
    const origin = allEmbeddings
      .filter(e => e.filePath === file.path)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)[0];

    if (!origin) {
      this.renderEmpty('This file has not been indexed yet.');
      return;
    }

    const neighbors = this.plugin.vectorIndex.query(
      origin.embedding,
      this.plugin.settings.similarityThreshold,
      this.plugin.settings.maxResults,
      file.path,
    );

    this.cachedNeighbors = neighbors;
    this.renderResults(neighbors, this.plugin.settings.similarityThreshold);
  }

  private renderResults(neighbors: Neighbor[], threshold: number): void {
    this.contentEl.empty();

    // Header
    const header = this.contentEl.createDiv('ito-panel-header');
    header.createEl('span', { text: 'Ito — related', cls: 'ito-panel-title' });
    const refreshBtn = header.createEl('button', { cls: 'ito-icon-btn', attr: { 'aria-label': 'Refresh' } });
    refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
    refreshBtn.addEventListener('click', () => {
      const file = this.app.workspace.getActiveFile();
      if (file) this.refresh(file);
    });

    // Threshold slider
    const sliderWrap = this.contentEl.createDiv('ito-slider-wrap');
    const sliderLabel = sliderWrap.createEl('span', {
      text: `Threshold: ${Math.round(threshold * 100)}%`,
      cls: 'ito-slider-label',
    });
    const slider = sliderWrap.createEl('input', { cls: 'ito-threshold-slider' }) as HTMLInputElement;
    slider.type = 'range';
    slider.min = '50';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(Math.round(threshold * 100));
    slider.addEventListener('input', () => {
      const t = Number(slider.value) / 100;
      sliderLabel.textContent = `Threshold: ${slider.value}%`;
      const filtered = this.cachedNeighbors.filter(n => n.similarity >= t);
      this.renderResultList(filtered);
    });

    this.contentEl.createDiv('ito-result-list', el => {
      el.id = 'ito-result-list';
    });
    const filtered = neighbors.filter(n => n.similarity >= threshold);
    this.renderResultList(filtered);
  }

  private renderResultList(neighbors: Neighbor[]): void {
    const list = this.contentEl.querySelector('#ito-result-list') as HTMLElement;
    if (!list) return;
    list.empty();

    if (neighbors.length === 0) {
      list.createEl('p', { text: 'No related files found. Try lowering the threshold.', cls: 'ito-empty' });
      return;
    }

    for (const neighbor of neighbors) {
      list.appendChild(this.buildResultRow(neighbor));
    }
  }

  private buildResultRow(neighbor: Neighbor): HTMLElement {
    const row = createDiv('ito-result-row');

    // File name
    const nameEl = row.createEl('button', {
      text: neighbor.filePath.split('/').pop()?.replace(/\..*$/, '') ?? neighbor.filePath,
      cls: 'ito-file-name',
    });
    nameEl.addEventListener('click', () => {
      this.app.workspace.openLinkText(neighbor.filePath, '', false);
    });

    // Badges row
    const meta = row.createDiv('ito-result-meta');
    meta.createEl('span', { text: this.modalityLabel(neighbor.modality), cls: `ito-badge ito-badge--${neighbor.modality}` });
    meta.createEl('span', { text: `${Math.round(neighbor.similarity * 100)}%`, cls: 'ito-similarity' });

    // Excerpt / media info
    if (neighbor.summary) {
      row.createEl('p', { text: neighbor.summary, cls: 'ito-excerpt' });
    }

    // Add as backlink
    const backlinkBtn = row.createEl('button', { text: 'Add as backlink', cls: 'ito-backlink-btn' });
    backlinkBtn.addEventListener('click', async () => {
      await this.addBacklink(neighbor.filePath);
    });

    return row;
  }

  async addBacklink(targetFilePath: string): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const content = await this.app.vault.read(activeFile);
    const targetName = targetFilePath.replace(/\.md$/, '');
    const collection = new RelatedCollection(content);
    const updated = collection.append(targetName);

    await this.app.vault.modify(activeFile, updated);
    new Notice('Ito: link added to Related section.');
  }

  private renderState(type: 'loading' | 'no-key', message: string): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: message, cls: `ito-state ito-state--${type}` });
  }

  private renderEmpty(message: string): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: message, cls: 'ito-state ito-state--empty' });
  }

  private modalityLabel(modality: string): string {
    const labels: Record<string, string> = {
      text: 'Note', image: 'Image', pdf: 'PDF', audio: 'Audio', video: 'Video',
    };
    return labels[modality] ?? modality;
  }
}
