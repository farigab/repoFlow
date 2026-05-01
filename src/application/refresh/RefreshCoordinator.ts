import * as vscode from 'vscode';

interface RefreshCoordinatorDeps {
  invalidateBlameCache: () => void;
  refreshBranchTree: () => void;
  refreshGraph: () => Promise<void>;
  output: vscode.OutputChannel;
}

export class RefreshCoordinator implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private pending = false;
  private disposed = false;

  public constructor(
    private readonly deps: RefreshCoordinatorDeps,
    private readonly debounceMs = 250
  ) { }

  public requestRefresh(_reason = 'unknown'): void {
    if (this.disposed) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runRefresh();
    }, this.debounceMs);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async runRefresh(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.inFlight) {
      this.pending = true;
      return;
    }

    this.inFlight = true;
    try {
      this.deps.invalidateBlameCache();
      this.deps.refreshBranchTree();
      await this.deps.refreshGraph();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.output.appendLine(`[refresh-coordinator] ${message}`);
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        this.requestRefresh('pending');
      }
    }
  }
}
