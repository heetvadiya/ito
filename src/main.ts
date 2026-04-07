import { Editor, Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_INDEX_POLICY, IndexPolicy } from './types';
import { ItoStore } from './store';
import { ItoEmbedder } from './embedder';
import { ItoIndexer } from './indexer';
import { ItoVectorIndex } from './vector-index';
import { ItoSettingTab } from './settings';
import { ItoPanel, ITO_PANEL_VIEW_TYPE } from './panel';
import { ItoResultsModal } from './modal';

export default class ItoPlugin extends Plugin {
  settings!: IndexPolicy;
  store!: ItoStore;
  embedder!: ItoEmbedder;
  indexer!: ItoIndexer;
  vectorIndex!: ItoVectorIndex;

  async onload(): Promise<void> {
    await this.loadSettings();

    const pluginDir = `${this.app.vault.configDir}/plugins/ito`;
    this.store = new ItoStore(pluginDir);

    this.embedder = new ItoEmbedder(
      this.settings.geminiApiKey,
      this.settings.embeddingDimension,
    );

    this.vectorIndex = new ItoVectorIndex(this.store);

    this.indexer = new ItoIndexer(
      this.app,
      this.store,
      this.embedder,
      () => this.settings,
    );

    // Propagate indexer events to the open panel
    this.indexer.on(event => {
      if (event.type === 'file-indexed') this.refreshPanel();
    });

    // Register panel view
    this.registerView(
      ITO_PANEL_VIEW_TYPE,
      leaf => new ItoPanel(leaf, this),
    );

    // Ribbon icon
    this.addRibbonIcon('git-branch', 'Ito — related files', () => {
      this.togglePanel();
    });

    // Settings tab
    this.addSettingTab(new ItoSettingTab(this.app, this));

    // Vault events
    this.registerEvent(
      this.app.vault.on('create', file => {
        if (file instanceof TFile) this.indexer.enqueue(file);
      })
    );
    this.registerEvent(
      this.app.vault.on('modify', file => {
        if (file instanceof TFile && this.settings.autoIndexOnSave) {
          this.indexer.enqueue(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', file => {
        if (file instanceof TFile) this.indexer.removeFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) this.indexer.renameFile(oldPath, file);
      })
    );

    // Active file change → refresh panel
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.refreshPanel())
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

        const notice = new Notice('Ito: finding similar content…', 0);
        try {
          const vector = await this.embedder.embed({ type: 'text', content: selected });
          const results = this.vectorIndex.query(
            vector,
            this.settings.similarityThreshold,
            this.settings.maxResults,
            this.app.workspace.getActiveFile()?.path ?? '',
          );
          notice.hide();
          new ItoResultsModal(
            this.app,
            results,
            path => this.addBacklinkToActiveFile(path),
          ).open();
        } catch (err: unknown) {
          notice.hide();
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`Ito: ${msg}`);
        }
      },
    });

    this.addCommand({
      id: 'reindex-vault',
      name: 'Rebuild index from scratch',
      callback: async () => {
        new Notice('Ito: rebuilding index from scratch…');
        await this.indexer.reindexAll();
      },
    });

    // Reconcile after layout ready — never block Obsidian startup
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.geminiApiKey) {
        this.indexer.reconcile();
      }
    });
  }

  async onunload(): Promise<void> {
    this.store.close();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_INDEX_POLICY,
      (await this.loadData()) as Partial<IndexPolicy>,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async togglePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(ITO_PANEL_VIEW_TYPE);
    if (existing.length > 0) {
      existing[0].detach();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: ITO_PANEL_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private refreshPanel(): void {
    const panels = this.app.workspace.getLeavesOfType(ITO_PANEL_VIEW_TYPE);
    const activeFile = this.app.workspace.getActiveFile();
    if (panels.length > 0 && activeFile) {
      (panels[0].view as ItoPanel).refresh(activeFile);
    }
  }

  private async addBacklinkToActiveFile(targetPath: string): Promise<void> {
    const panel = this.app.workspace.getLeavesOfType(ITO_PANEL_VIEW_TYPE)[0]?.view as ItoPanel | undefined;
    if (panel) {
      await panel.addBacklink(targetPath);
    }
  }
}
