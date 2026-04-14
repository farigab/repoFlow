import * as vscode from 'vscode';
import type { GitRepository } from '../../core/ports/GitRepository';

interface GitDocumentQuery {
  repoRoot: string;
  ref: string;
  path: string;
}

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'gitgraphor';

  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor(private readonly repository: GitRepository) {}

  public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
    const query = this.parseQuery(uri);
    return this.repository.readBlobContent(query.repoRoot, query.ref, query.path);
  }

  public createUri(repoRoot: string, ref: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(
      `${GitContentProvider.scheme}:${encodeURIComponent(filePath)}?repoRoot=${encodeURIComponent(repoRoot)}&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(filePath)}`
    );
  }

  public refresh(uri: vscode.Uri): void {
    this.onDidChangeEmitter.fire(uri);
  }

  private parseQuery(uri: vscode.Uri): GitDocumentQuery {
    const query = new URLSearchParams(uri.query);
    const repoRoot = query.get('repoRoot');
    const ref = query.get('ref');
    const targetPath = query.get('path');

    if (!repoRoot || !ref || !targetPath) {
      throw new Error('URI de diff inválida.');
    }

    return {
      repoRoot,
      ref,
      path: targetPath
    };
  }
}
