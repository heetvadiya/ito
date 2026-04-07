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

    const list = contentEl.createDiv('ito-result-list');

    for (const neighbor of this.results) {
      const row = list.createDiv('ito-result-row');

      const nameEl = row.createEl('button', {
        text: neighbor.filePath.split('/').pop()?.replace(/\..*$/, '') ?? neighbor.filePath,
        cls: 'ito-file-name',
      });
      nameEl.addEventListener('click', () => {
        this.app.workspace.openLinkText(neighbor.filePath, '', false);
        this.close();
      });

      const meta = row.createDiv('ito-result-meta');
      meta.createEl('span', {
        text: this.modalityLabel(neighbor.modality),
        cls: `ito-badge ito-badge--${neighbor.modality}`,
      });
      meta.createEl('span', {
        text: `${Math.round(neighbor.similarity * 100)}%`,
        cls: 'ito-similarity',
      });

      if (neighbor.summary) {
        row.createEl('p', { text: neighbor.summary, cls: 'ito-excerpt' });
      }

      const backlinkBtn = row.createEl('button', { text: 'Add as backlink', cls: 'ito-backlink-btn' });
      backlinkBtn.addEventListener('click', async () => {
        await this.onAddBacklink(neighbor.filePath);
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
