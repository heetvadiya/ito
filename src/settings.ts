import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_INDEX_POLICY, EmbeddingDimension, IndexPolicy } from './types';
import type ItoPlugin from './main';

export type { IndexPolicy };
export { DEFAULT_INDEX_POLICY };

export class ItoSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ItoPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── API Key ────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Gemini API key')
      .setDesc('Required for all functionality. Your key is stored locally and never shared.')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('Paste Gemini API key')
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async value => {
            this.plugin.settings.geminiApiKey = value;
            this.plugin.embedder.updateApiKey(value);
            await this.plugin.saveSettings();
          });
      });

    // ── Test API Key ───────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Test API key')
      .setDesc('Send a quick test embedding to verify your key and model access.')
      .addButton(btn => btn
        .setButtonText('Test connection')
        .onClick(async () => {
          if (!this.plugin.settings.geminiApiKey) {
            new Notice('Ito: paste an API key first.');
            return;
          }
          btn.setButtonText('Testing…');
          btn.setDisabled(true);
          try {
            await this.plugin.embedder.embed({ type: 'text', content: 'test' });
            new Notice('Ito: API key works. Model is accessible.');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Ito: test failed — ${msg}`, 8000);
          } finally {
            btn.setButtonText('Test connection');
            btn.setDisabled(false);
          }
        }));

    // ── Indexed Folders ────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Indexed folders')
      .setDesc('Comma-separated folder paths. Leave empty to index the entire vault.')
      .addText(text => text
        .setPlaceholder('folder1, folder2 (empty = entire vault)')
        .setValue(this.plugin.settings.indexedFolders.join(', '))
        .onChange(async value => {
          this.plugin.settings.indexedFolders = value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        }));

    // ── Embedding Dimension ────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Embedding dimension')
      .setDesc('Changing this dimension requires a full re-index of your vault.')
      .addDropdown(drop => {
        drop
          .addOption('768',  '768 — fast, cost-efficient')
          .addOption('1536', '1536 — balanced')
          .addOption('3072', '3072 — best quality')
          .setValue(String(this.plugin.settings.embeddingDimension))
          .onChange(async value => {
            const prev = this.plugin.settings.embeddingDimension;
            const next = Number(value) as EmbeddingDimension;
            if (prev === next) return;
            this.plugin.settings.embeddingDimension = next;
            this.plugin.embedder.updateDimension(next);
            await this.plugin.saveSettings();
            new Notice('Ito: dimension changed — rebuilding index from scratch.');
            await this.plugin.indexer.reindexAll();
          });
      });

    // Cost warning
    const warning = containerEl.createEl('p', {
      text: 'Audio and video files consume significantly more API quota than text files. Monitor your Gemini API usage dashboard during initial indexing.',
      cls: 'ito-cost-warning',
    });
    warning.style.cssText = 'margin: -8px 0 16px 0; font-size: 12px; color: var(--ito-tertiary);';

    // ── Similarity Threshold ───────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Similarity threshold')
      .setDesc('Minimum similarity score for a file to appear in results.')
      .addSlider(slider => slider
        .setLimits(50, 100, 1)
        .setValue(Math.round(this.plugin.settings.similarityThreshold * 100))
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.similarityThreshold = value / 100;
          await this.plugin.saveSettings();
        }));

    // ── Max Results ────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Max results')
      .setDesc('Maximum number of related files shown in the panel (3–20).')
      .addText(text => text
        .setValue(String(this.plugin.settings.maxResults))
        .onChange(async value => {
          const n = parseInt(value, 10);
          if (isNaN(n) || n < 3 || n > 20) return;
          this.plugin.settings.maxResults = n;
          await this.plugin.saveSettings();
        }));

    // ── Toggles ────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Auto-index on save')
      .setDesc('Re-index a file automatically when you save it.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoIndexOnSave)
        .onChange(async value => {
          this.plugin.settings.autoIndexOnSave = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Index audio files')
      .setDesc('Include mp3, wav, m4a, ogg, and flac files in the index.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.indexAudio)
        .onChange(async value => {
          this.plugin.settings.indexAudio = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Index video files')
      .setDesc('Include mp4, mov, and webm files. Opt-in — video files are large and consume significant API quota.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.indexVideo)
        .onChange(async value => {
          this.plugin.settings.indexVideo = value;
          await this.plugin.saveSettings();
        }));

    // ── Max File Size ──────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Max file size')
      .setDesc('Files larger than this are skipped silently.')
      .addText(text => {
        text.inputEl.type = 'number';
        text
          .setValue(String(this.plugin.settings.maxFileSizeMb))
          .setPlaceholder('50')
          .onChange(async value => {
            const n = parseFloat(value);
            if (isNaN(n) || n <= 0) return;
            this.plugin.settings.maxFileSizeMb = n;
            await this.plugin.saveSettings();
          });
        text.inputEl.after(Object.assign(document.createElement('span'), {
          textContent: ' MB',
          className: 'ito-setting-suffix',
        }));
      });

    // ── Danger Zone ────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Index management', cls: 'ito-settings-section' });

    new Setting(containerEl)
      .setName('Re-index entire vault')
      .setDesc('Wipe the existing index and re-embed every file from scratch.')
      .addButton(btn => btn
        .setButtonText('Re-index entire vault')
        .onClick(async () => {
          new Notice('Ito: rebuilding index from scratch…');
          await this.plugin.indexer.reindexAll();
        }));

    new Setting(containerEl)
      .setName('Clear index')
      .setDesc('Permanently delete all stored embeddings. Does not re-index.')
      .addButton(btn => btn
        .setButtonText('Clear index')
        .setWarning()
        .onClick(() => {
          const confirmed = confirm('Clear the entire Ito index? This cannot be undone.');
          if (!confirmed) return;
          this.plugin.store.clearAll();
          new Notice('Ito: index cleared.');
        }));
  }
}
