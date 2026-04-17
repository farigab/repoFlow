import * as vscode from 'vscode';
import type { BranchSummary } from '../../core/models/GitModels';
import type { GitRepository } from '../../core/ports/GitRepository';

// ─────────────────────────────────────────────
// Item kinds
// ─────────────────────────────────────────────

type ItemKind = 'root-group' | 'prefix-folder' | 'branch';

export class BranchTreeItem extends vscode.TreeItem {
  public readonly kind: ItemKind;
  public readonly branch?: BranchSummary;

  constructor(opts: {
    kind: 'root-group';
    label: string;
    icon: string;
    children: BranchTreeItem[];
  });
  constructor(opts: {
    kind: 'prefix-folder';
    label: string;
    children: BranchTreeItem[];
  });
  constructor(opts: {
    kind: 'branch';
    branch: BranchSummary;
  });
  constructor(opts: {
    kind: ItemKind;
    label?: string;
    icon?: string;
    children?: BranchTreeItem[];
    branch?: BranchSummary;
  }) {
    if (opts.kind === 'branch') {
      const b = opts.branch!;
      const displayName = b.shortName.includes('/')
        ? b.shortName.slice(b.shortName.indexOf('/') + 1)
        : b.shortName;

      super(
        displayName,
        vscode.TreeItemCollapsibleState.None
      );

      this.kind = 'branch';
      this.branch = b;

      // Show tracking info (ahead/behind) as description
      if (b.tracking) {
        this.description = b.tracking;
      } else if (b.upstream) {
        this.description = `→ ${b.upstream}`;
      }

      this.tooltip = b.shortName;
      this.contextValue = 'branch';

      if (b.current) {
        this.iconPath = new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
        this.description = (this.description ? `${this.description}  ` : '') + '●';
      } else {
        this.iconPath = new vscode.ThemeIcon('git-branch');
      }
    } else if (opts.kind === 'prefix-folder') {
      super(opts.label!, vscode.TreeItemCollapsibleState.Expanded);
      this.kind = 'prefix-folder';
      this.iconPath = new vscode.ThemeIcon('folder');
      this.contextValue = 'branchFolder';
    } else {
      // root-group
      super(opts.label!, vscode.TreeItemCollapsibleState.Expanded);
      this.kind = 'root-group';
      this.iconPath = new vscode.ThemeIcon(opts.icon ?? 'git-branch');
      this.contextValue = 'branchGroup';
    }
  }
}

// ─────────────────────────────────────────────
// TreeDataProvider
// ─────────────────────────────────────────────

export class BranchTreeDataProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeItem | undefined | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private roots: BranchTreeItem[] = [];

  public constructor(private readonly repository: GitRepository) { }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (!element) {
      // Build fresh tree from git
      await this.buildTree();
      return this.roots;
    }

    if (element.kind === 'root-group' || element.kind === 'prefix-folder') {
      // Children are stored during build; re-fetch from tree
      return this.findChildren(element);
    }

    return [];
  }

  // ─── Build ───────────────────────────────

  private childrenMap = new Map<BranchTreeItem, BranchTreeItem[]>();

  private async buildTree(): Promise<void> {
    this.childrenMap.clear();
    this.roots = [];

    let repoRoot: string;
    try {
      repoRoot = await this.repository.resolveRepositoryRoot();
    } catch {
      return;
    }

    let branches: BranchSummary[];
    try {
      branches = await this.repository.getBranches(repoRoot);
    } catch {
      return;
    }

    const local = branches.filter((b) => !b.remote);
    const remote = branches.filter((b) => b.remote);

    const localRoot = this.buildGroupNode('Local', 'git-branch', local);
    const remoteRoot = this.buildGroupNode('Remote', 'cloud', remote);

    this.roots = [];
    if (localRoot) this.roots.push(localRoot);
    if (remoteRoot) this.roots.push(remoteRoot);
  }

  private buildGroupNode(
    label: string,
    icon: string,
    branches: BranchSummary[]
  ): BranchTreeItem | undefined {
    if (branches.length === 0) return undefined;

    // Group by prefix (first segment before '/')
    const byPrefix = new Map<string, BranchSummary[]>();
    const ungrouped: BranchSummary[] = [];

    for (const b of branches) {
      const slashIdx = b.shortName.indexOf('/');
      if (slashIdx !== -1) {
        const prefix = b.shortName.slice(0, slashIdx);
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix)!.push(b);
      } else {
        ungrouped.push(b);
      }
    }

    const children: BranchTreeItem[] = [];

    // Prefix folders first (sorted alphabetically)
    const sortedPrefixes = [...byPrefix.keys()].sort((a, b) => a.localeCompare(b));
    for (const prefix of sortedPrefixes) {
      const branchItems = byPrefix.get(prefix)!.map((b) => new BranchTreeItem({ kind: 'branch', branch: b }));
      const folder = new BranchTreeItem({ kind: 'prefix-folder', label: prefix, children: branchItems });
      this.childrenMap.set(folder, branchItems);
      children.push(folder);
    }

    // Ungrouped branches (sorted: current first, then alphabetically)
    const sortedUngrouped = ungrouped.sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      return a.shortName.localeCompare(b.shortName);
    });
    for (const b of sortedUngrouped) {
      children.push(new BranchTreeItem({ kind: 'branch', branch: b }));
    }

    const group = new BranchTreeItem({ kind: 'root-group', label, icon, children });
    this.childrenMap.set(group, children);
    return group;
  }

  private findChildren(element: BranchTreeItem): BranchTreeItem[] {
    return this.childrenMap.get(element) ?? [];
  }
}
