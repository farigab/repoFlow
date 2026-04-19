import * as vscode from 'vscode';
import type { BranchSummary } from '../../core/models';
import type { GitQueryPort } from '../../core/ports/GitQueryPort';

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
    displayLabel?: string;
  });
  constructor(opts: {
    kind: ItemKind;
    label?: string;
    icon?: string;
    children?: BranchTreeItem[];
    branch?: BranchSummary;
    displayLabel?: string;
  }) {
    if (opts.kind === 'branch') {
      const b = opts.branch!;
      super(BranchTreeItem.resolveDisplayName(b, opts.displayLabel), vscode.TreeItemCollapsibleState.None);
      this.kind = 'branch';
      this.branch = b;
      this.description = BranchTreeItem.resolveDescription(b);
      this.tooltip = b.shortName;
      this.contextValue = 'branch';
      this.iconPath = b.current
        ? new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('gitDecoration.addedResourceForeground'))
        : new vscode.ThemeIcon('git-branch');
      if (b.current) {
        this.description = (this.description ? `${this.description}  ` : '') + '●';
      }
    } else if (opts.kind === 'prefix-folder') {
      super(opts.label!, vscode.TreeItemCollapsibleState.Expanded);
      this.kind = 'prefix-folder';
      this.iconPath = new vscode.ThemeIcon('folder');
      this.contextValue = 'branchFolder';
    } else {
      super(opts.label!, vscode.TreeItemCollapsibleState.Expanded);
      this.kind = 'root-group';
      this.iconPath = new vscode.ThemeIcon(opts.icon ?? 'git-branch');
      this.contextValue = 'branchGroup';
    }
  }

  private static resolveDisplayName(b: BranchSummary, displayLabel?: string): string {
    return displayLabel ?? (
      b.shortName.includes('/')
        ? b.shortName.slice(b.shortName.indexOf('/') + 1)
        : b.shortName
    );
  }

  private static resolveDescription(b: BranchSummary): string | undefined {
    const trackParts: string[] = [];
    if (b.ahead) trackParts.push(`↑${b.ahead}`);
    if (b.behind) trackParts.push(`↓${b.behind}`);
    if (trackParts.length > 0) return trackParts.join(' ');
    if (b.upstream) return `→ ${b.upstream}`;
    return undefined;
  }
}

// ─────────────────────────────────────────────
// TreeDataProvider
// ─────────────────────────────────────────────

export class BranchTreeDataProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeItem | undefined | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private roots: BranchTreeItem[] = [];

  public constructor(private readonly repository: GitQueryPort) { }

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

  private readonly childrenMap = new Map<BranchTreeItem, BranchTreeItem[]>();

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

    const children = this.buildChildItems(branches, 0);
    const group = new BranchTreeItem({ kind: 'root-group', label, icon, children });
    this.childrenMap.set(group, children);
    return group;
  }

  /**
   * Recursively group branches by path segments, starting at character offset `offset`
   * within each branch's shortName. Branches whose remaining name (after `offset`) still
   * contain a '/' are placed under a prefix-folder for the next segment.
   */
  private buildChildItems(branches: BranchSummary[], offset: number): BranchTreeItem[] {
    const byNextSegment = new Map<string, BranchSummary[]>();
    const ungrouped: BranchSummary[] = [];

    for (const b of branches) {
      const remaining = b.shortName.slice(offset);
      const slashIdx = remaining.indexOf('/');
      if (slashIdx === -1) {
        ungrouped.push(b);
      } else {
        const segment = remaining.slice(0, slashIdx);
        if (!byNextSegment.has(segment)) byNextSegment.set(segment, []);
        byNextSegment.get(segment)!.push(b);
      }
    }

    const children: BranchTreeItem[] = [];

    // Prefix folders first (sorted alphabetically)
    const sortedSegments = [...byNextSegment.keys()].sort((a, b) => a.localeCompare(b));
    for (const segment of sortedSegments) {
      const subBranches = byNextSegment.get(segment)!;
      // +1 for the '/' separator
      const subChildren = this.buildChildItems(subBranches, offset + segment.length + 1);
      const folder = new BranchTreeItem({ kind: 'prefix-folder', label: segment, children: subChildren });
      this.childrenMap.set(folder, subChildren);
      children.push(folder);
    }

    // Ungrouped branches (sorted: current first, then alphabetically)
    const sortedUngrouped = [...ungrouped].sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      return a.shortName.localeCompare(b.shortName);
    });

    for (const b of sortedUngrouped) {
      const displayLabel = b.shortName.slice(offset);
      children.push(new BranchTreeItem({ kind: 'branch', branch: b, displayLabel }));
    }

    return children;
  }

  private findChildren(element: BranchTreeItem): BranchTreeItem[] {
    return this.childrenMap.get(element) ?? [];
  }
}
