import * as vscode from 'vscode';
import type { GraphFilters } from '../../core/models/GitModels';
import type { GitRepository } from '../../core/ports/GitRepository';
import { createNonce } from '../../shared/nonce';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../shared/protocol';

export class GitGraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gitGraphor.graphPanel';
  public static readonly viewId = 'gitGraphor.graphView';

  private currentPanel?: vscode.WebviewPanel;
  private currentView?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private filters: GraphFilters = {
    includeRemotes: true,
    limit: 200
  };
  private selectedCommitHash?: string;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repository: GitRepository,
    private readonly output: vscode.OutputChannel
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.currentView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media')
      ]
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => { void this.handleMessage(message); },
      undefined,
      this.disposables
    );

    webviewView.onDidDispose(() => {
      this.currentView = undefined;
    }, undefined, this.disposables);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    }, undefined, this.disposables);

    void this.refresh();
  }

  public openOrReveal(): void {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      GitGraphViewProvider.viewType,
      'GitGraphor',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'media')
        ]
      }
    );

    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
    panel.webview.html = this.renderHtml(panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => { void this.handleMessage(message); },
      undefined,
      this.disposables
    );

    panel.onDidDispose(() => {
      this.currentPanel = undefined;
      for (const d of this.disposables) { d.dispose(); }
      this.disposables = [];
    }, undefined, this.disposables);

    this.currentPanel = panel;
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.currentPanel && !this.currentView?.visible) {
      return;
    }

    await this.withBusy('Atualizando grafo Git...', async () => {
      const snapshot = await this.repository.getGraph(this.filters);
      await this.postMessage({ type: 'graphSnapshot', payload: snapshot });

      if (this.selectedCommitHash) {
        const detail = await this.repository.getCommitDetail(snapshot.repoRoot, this.selectedCommitHash);
        await this.postMessage({ type: 'commitDetail', payload: detail });
      }
    });
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.refresh();
        return;
      case 'loadMore':
        this.filters = { ...this.filters, limit: message.payload.limit };
        await this.refresh();
        return;
      case 'applyFilters':
        this.filters = { ...this.filters, ...message.payload };
        await this.refresh();
        return;
      case 'selectCommit':
        this.selectedCommitHash = message.payload.commitHash;
        await this.withBusy('Carregando detalhes do commit...', async () => {
          const detail = await this.repository.getCommitDetail(message.payload.repoRoot, message.payload.commitHash);
          await this.postMessage({ type: 'commitDetail', payload: detail });
        });
        return;
      case 'openDiff':
        await this.repository.openDiff(message.payload);
        return;
      case 'fetch':
        await this.executeRepositoryAction('Executando fetch...', async () => {
          await this.repository.fetch(message.payload.repoRoot);
        });
        return;
      case 'pull':
        await this.executeRepositoryAction('Executando pull...', async () => {
          await this.repository.pull(message.payload.repoRoot);
        });
        return;
      case 'push':
        await this.executeRepositoryAction('Executando push...', async () => {
          await this.repository.push(message.payload.repoRoot);
        });
        return;
      case 'createBranchPrompt': {
        const name = await vscode.window.showInputBox({
          title: 'Create Branch',
          prompt: 'Nome da nova branch',
          ignoreFocusOut: true,
          validateInput: (value) => (value.trim() ? undefined : 'Informe um nome para a branch.')
        });

        if (!name) {
          return;
        }

        await this.executeRepositoryAction('Criando branch...', async () => {
          await this.repository.createBranch(message.payload.repoRoot, name.trim(), message.payload.fromRef);
        });
        return;
      }
      case 'deleteBranch': {
        const confirmed = await vscode.window.showWarningMessage(
          `Excluir a branch ${message.payload.branchName}?`,
          { modal: true },
          'Excluir'
        );

        if (confirmed !== 'Excluir') {
          return;
        }

        await this.executeRepositoryAction('Excluindo branch...', async () => {
          await this.repository.deleteBranch(message.payload.repoRoot, message.payload.branchName);
        });
        return;
      }
      case 'checkoutBranch':
        await this.executeRepositoryAction('Fazendo checkout...', async () => {
          await this.repository.checkout(message.payload.repoRoot, message.payload.branchName);
        });
        return;
      case 'mergeBranchPrompt': {
        const confirmed = await vscode.window.showWarningMessage(
          `Fazer merge de ${message.payload.branchName} na branch atual?`,
          { modal: true },
          'Merge'
        );

        if (confirmed !== 'Merge') {
          return;
        }

        await this.executeRepositoryAction('Executando merge...', async () => {
          await this.repository.merge(message.payload.repoRoot, message.payload.branchName);
        });
        return;
      }
      case 'checkoutCommit': {
        const confirmed = await vscode.window.showWarningMessage(
          `Checkout em detached HEAD para ${message.payload.commitHash.slice(0, 8)}?`,
          { modal: true },
          'Checkout'
        );

        if (confirmed !== 'Checkout') {
          return;
        }

        await this.executeRepositoryAction('Executando checkout do commit...', async () => {
          await this.repository.checkout(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      }
      case 'cherryPick':
        await this.executeRepositoryAction('Executando cherry-pick...', async () => {
          await this.repository.cherryPick(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      case 'copyHash':
        await vscode.env.clipboard.writeText(message.payload.hash);
        await this.postNotification('info', 'Hash copiado para a área de transferência.');
        return;
      case 'openInTerminal': {
        const terminal = vscode.window.createTerminal({ cwd: message.payload.repoRoot, name: 'Git Graphor' });
        terminal.show();
        terminal.sendText(message.payload.command, true);
        return;
      }
      case 'stageFile':
        await this.executeRepositoryAction('Adicionando arquivo ao stage...', async () => {
          await this.repository.stageFile(message.payload.repoRoot, message.payload.file.path);
        });
        return;
      case 'unstageFile':
        await this.executeRepositoryAction('Removendo arquivo do stage...', async () => {
          await this.repository.unstageFile(message.payload.repoRoot, message.payload.file.path);
        });
        return;
      case 'discardFile': {
        const confirmed = await vscode.window.showWarningMessage(
          `Descartar alterações em ${message.payload.file.path}?`,
          { modal: true },
          'Descartar'
        );

        if (confirmed !== 'Descartar') {
          return;
        }

        const tracked = message.payload.file.indexStatus !== '?' && message.payload.file.workTreeStatus !== '?';
        await this.executeRepositoryAction('Descartando alterações...', async () => {
          await this.repository.discardFile(message.payload.repoRoot, message.payload.file.path, tracked);
        });
        return;
      }
      case 'commitChangesPrompt': {
        const messageText = await vscode.window.showInputBox({
          title: 'Commit Changes',
          prompt: 'Mensagem do commit',
          ignoreFocusOut: true,
          validateInput: (value) => (value.trim() ? undefined : 'Informe uma mensagem de commit.')
        });

        if (!messageText) {
          return;
        }

        await this.executeRepositoryAction('Criando commit...', async () => {
          await this.repository.commit(message.payload.repoRoot, messageText.trim());
        });
        return;
      }
      default:
        return;
    }
  }

  private async executeRepositoryAction(label: string, action: () => Promise<void>): Promise<void> {
    await this.withBusy(label, async () => {
      await action();
      await this.refresh();
      await this.postNotification('info', 'Operação concluída com sucesso.');
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
    });
  }

  private async withBusy(label: string, action: () => Promise<void>): Promise<void> {
    await this.postMessage({ type: 'busy', payload: { value: true, label } });
    try {
      await action();
    } finally {
      await this.postMessage({ type: 'busy', payload: { value: false } });
    }
  }

  private async postNotification(kind: 'info' | 'error', message: string): Promise<void> {
    await this.postMessage({
      type: 'notification',
      payload: { kind, message }
    });
  }

  private async postMessage(message: ExtensionToWebviewMessage): Promise<void> {
    const sends: Array<Promise<boolean>> = [];
    if (this.currentView?.visible) {
      sends.push(this.currentView.webview.postMessage(message));
    }
    if (this.currentPanel != null) {
      sends.push(this.currentPanel.webview.postMessage(message));
    }
    await Promise.all(sends);
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.css'));
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hero.svg'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Git Graphor</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__GITGRAPHOR_ASSETS__ = {
        hero: '${iconUri}'
      };
    </script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
