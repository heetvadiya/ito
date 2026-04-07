import { App, Modal } from 'obsidian';
import { Neighbor } from './types';

export class ItoResultsModal extends Modal {
  constructor(
    app: App,
    private readonly results: Neighbor[],
    private readonly onAddBacklink: (filePath: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ito-modal');

    contentEl.createEl('h2', { text: 'Ito — similar content', cls: 'ito-modal-title' });

    if (this.results.length === 0) {
      contentEl.createEl('p', {
        text: 'No results found. Try lowering the similarity threshold in Ito settings.',
        cls: 'ito-empty',
      });
      return;
    }

    const tiles = contentEl.createDiv('ito-tiles');

    for (const neighbor of this.results) {
      const tile = tiles.createDiv('ito-tile');

      const top = tile.createDiv('ito-tile-top');
      const name = neighbor.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? neighbor.filePath;
      const titleEl = top.createEl('button', { text: name, cls: 'ito-tile-title' });
      titleEl.addEventListener('click', () => {
        this.app.workspace.openLinkText(neighbor.filePath, '', false);
        this.close();
      });
      top.createEl('span', {
        text: `${Math.round(neighbor.similarity * 100)}%`,
        cls: 'ito-tile-score',
      });

      if (neighbor.summary) {
        const snippet = tile.createDiv('ito-tile-snippet');
        snippet.createEl('span', { text: 'matched content', cls: 'ito-snippet-label' });
        snippet.createEl('p', { text: neighbor.summary, cls: 'ito-snippet-text' });
      }

      const footer = tile.createDiv('ito-tile-footer');
      footer.createEl('span', {
        text: this.modalityLabel(neighbor.modality),
        cls: `ito-badge ito-badge--${neighbor.modality}`,
      });

      const linkBtn = footer.createEl('button', { text: '+ Link', cls: 'ito-btn-link' });
      linkBtn.addEventListener('click', async () => {
        await this.onAddBacklink(neighbor.filePath);
        linkBtn.setText('Linked ✓');
        linkBtn.addClass('ito-btn-link--done');
        linkBtn.disabled = true;
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private modalityLabel(modality: string): string {
    const labels: Record<string, string> = {
      text: 'Note', image: 'Image', pdf: 'PDF', audio: 'Audio', video: 'Video',
    };
    return labels[modality] ?? modality;
  }
}
