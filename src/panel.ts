import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { Neighbor } from './types';
import type ItoPlugin from './main';

export const ITO_PANEL_VIEW_TYPE = 'ito-panel';

class RelatedCollection {
  constructor(private content: string) {}

  append(wikiLink: string): string {
    const link = `[[${wikiLink}]]`;
    const relatedIdx = this.content.indexOf('\n## Related');
    if (relatedIdx !== -1) {
      const afterHeading = this.content.slice(relatedIdx + 1);
      const nextHeading = afterHeading.slice('## Related'.length).search(/\n## /);
      if (nextHeading !== -1) {
        const insertAt = relatedIdx + 1 + '## Related'.length + nextHeading;
        return this.content.slice(0, insertAt) + `\n${link}` + this.content.slice(insertAt);
      }
      return this.content.trimEnd() + `\n${link}\n`;
    }
    return this.content.trimEnd() + `\n\n## Related\n\n${link}\n`;
  }
}

export class ItoPanel extends ItemView {
  private cachedNeighbors: Neighbor[] = [];
  private panelContent!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ItoPlugin) {
    super(leaf);
  }

  getViewType(): string { return ITO_PANEL_VIEW_TYPE; }
  getDisplayText(): string { return 'Ito'; }
  getIcon(): string { return 'git-branch'; }

  async onOpen(): Promise<void> {
    this.panelContent = this.containerEl.children[1] as HTMLElement;
    this.panelContent.empty();
    this.panelContent.addClass('ito-panel');
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
    this.panelContent.empty();
  }

  async refresh(file: TFile): Promise<void> {
    if (!this.plugin.settings.geminiApiKey) {
      this.renderEmpty('Add your Gemini API key in settings to get started.');
      return;
    }

    this.renderEmpty('Finding threads…');

    const allEmbeddings = this.plugin.store.getAllEmbeddings();
    const origin = allEmbeddings
      .filter(e => e.filePath === file.path)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)[0];

    if (!origin) {
      this.renderEmpty('This file hasn\'t been indexed yet.');
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
    this.panelContent.empty();

    // ── Header ───────────────────────────────────────────────────────────
    const header = this.panelContent.createDiv('ito-header');
    const left = header.createDiv('ito-header-left');
    left.createEl('span', { text: 'Ito', cls: 'ito-wordmark' });
    left.createEl('span', { text: `${neighbors.length} related`, cls: 'ito-count' });

    const refreshBtn = header.createEl('button', { cls: 'ito-btn-icon', attr: { 'aria-label': 'Refresh' } });
    refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
    refreshBtn.addEventListener('click', () => {
      const file = this.app.workspace.getActiveFile();
      if (file) this.refresh(file);
    });

    // ── Threshold ────────────────────────────────────────────────────────
    const sliderRow = this.panelContent.createDiv('ito-slider-row');
    const labelLeft = sliderRow.createEl('span', { text: 'Match strength', cls: 'ito-slider-label' });
    const labelRight = sliderRow.createEl('span', {
      text: `${Math.round(threshold * 100)}%`,
      cls: 'ito-slider-value',
    });

    const sliderWrap = this.panelContent.createDiv('ito-slider-wrap');
    const slider = sliderWrap.createEl('input', { cls: 'ito-slider' }) as HTMLInputElement;
    slider.type = 'range';
    slider.min = '50';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(Math.round(threshold * 100));
    slider.addEventListener('input', () => {
      labelRight.setText(`${slider.value}%`);
      this.renderTiles(this.cachedNeighbors.filter(n => n.similarity >= Number(slider.value) / 100));
    });

    // ── Tiles ────────────────────────────────────────────────────────────
    this.panelContent.createDiv({ cls: 'ito-tiles', attr: { id: 'ito-tiles' } });
    this.renderTiles(neighbors.filter(n => n.similarity >= threshold));
  }

  private renderTiles(neighbors: Neighbor[]): void {
    const container = this.panelContent.querySelector('#ito-tiles') as HTMLElement;
    if (!container) return;
    container.empty();

    if (neighbors.length === 0) {
      container.createEl('p', { text: 'No matches at this threshold. Try sliding lower.', cls: 'ito-empty' });
      return;
    }

    for (const n of neighbors) container.appendChild(this.buildTile(n));
  }

  private buildTile(neighbor: Neighbor): HTMLElement {
    const name = neighbor.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? neighbor.filePath;

    // Entire tile is clickable — opens the file
    const tile = createDiv('ito-tile');
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.addEventListener('click', (e) => {
      // Don't navigate if user clicked the link button
      if ((e.target as HTMLElement).closest('.ito-btn-link')) return;
      this.app.workspace.openLinkText(neighbor.filePath, '', false);
    });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.app.workspace.openLinkText(neighbor.filePath, '', false);
    });

    // ── Category row: modality badge + score ─────────────────────────────
    const meta = tile.createDiv('ito-tile-meta');
    meta.createEl('span', {
      text: this.modalityLabel(neighbor.modality),
      cls: `ito-badge ito-badge--${neighbor.modality}`,
    });
    meta.createEl('span', { text: `${Math.round(neighbor.similarity * 100)}%`, cls: 'ito-score' });

    // ── Title ─────────────────────────────────────────────────────────────
    tile.createEl('p', { text: name, cls: 'ito-tile-title' });

    // ── Matched content snippet ───────────────────────────────────────────
    if (neighbor.summary) {
      const snippet = tile.createDiv('ito-tile-snippet');
      snippet.createEl('span', { text: 'matched content', cls: 'ito-snippet-label' });
      snippet.createEl('p', { text: neighbor.summary, cls: 'ito-snippet-text' });
    }

    // ── Link button ───────────────────────────────────────────────────────
    const footer = tile.createDiv('ito-tile-footer');
    const linkBtn = footer.createEl('button', { text: '+ Add link', cls: 'ito-btn-link' });
    linkBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.addBacklink(neighbor.filePath);
      linkBtn.setText('Linked ✓');
      linkBtn.addClass('ito-btn-link--done');
      linkBtn.disabled = true;
    });

    return tile;
  }

  async addBacklink(targetFilePath: string): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;
    const content = await this.app.vault.read(activeFile);
    const targetName = targetFilePath.replace(/\.md$/, '');
    const updated = new RelatedCollection(content).append(targetName);
    await this.app.vault.modify(activeFile, updated);
    new Notice('Ito: link added to Related section.');
  }

  private renderEmpty(message: string): void {
    this.panelContent.empty();
    this.panelContent.createDiv('ito-state-wrap').createEl('p', { text: message, cls: 'ito-state' });
  }

  private modalityLabel(modality: string): string {
    const labels: Record<string, string> = {
      text: 'Note', image: 'Image', pdf: 'PDF', audio: 'Audio', video: 'Video',
    };
    return labels[modality] ?? modality;
  }
}
