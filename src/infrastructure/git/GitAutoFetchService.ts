import * as vscode from 'vscode';
import type { GitRepository } from '../../core/ports/GitRepository';

const STARTUP_DELAY_MS = 3_000;
const FOCUS_DELAY_MS = 1_000;
const MIN_INTERVAL_MS = 30_000;
const DEFAULT_INTERVAL_MS = 120_000;
const RETRY_AFTER_FAILURE_MS = 300_000;

interface AutoFetchConfig {
  enabled: boolean;
  intervalMs: number;
}

export class GitAutoFetchService implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private disposed = false;
  private lastFetchByRepo = new Map<string, number>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly repository: GitRepository,
    private readonly onRepositoryChanged: () => void,
    private readonly output: vscode.OutputChannel
  ) { }

  public start(): void {
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.schedule(FOCUS_DELAY_MS);
        } else {
          this.clearTimer();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule(FOCUS_DELAY_MS)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoFlow.autoFetch')) {
          this.restart();
        }
      })
    );

    this.schedule(STARTUP_DELAY_MS);
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimer();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.lastFetchByRepo.clear();
  }

  private restart(): void {
    this.clearTimer();
    this.schedule(FOCUS_DELAY_MS);
  }

  private schedule(delayMs: number): void {
    this.clearTimer();

    const config = this.getConfig();
    if (this.disposed || !config.enabled || !vscode.window.state.focused) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.runCycle();
    }, delayMs);
  }

  private async runCycle(): Promise<void> {
    const config = this.getConfig();
    if (this.disposed || !config.enabled || !vscode.window.state.focused) {
      return;
    }

    if (this.inFlight) {
      this.schedule(config.intervalMs);
      return;
    }

    this.inFlight = true;
    let nextDelay = config.intervalMs;

    try {
      const repoRoot = await this.repository.resolveRepositoryRoot();
      const now = Date.now();
      const lastFetchAt = this.lastFetchByRepo.get(repoRoot) ?? 0;

      if (now - lastFetchAt >= config.intervalMs) {
        const repoConfig = await this.repository.getRepoConfig(repoRoot);
        if (repoConfig.remotes.length > 0) {
          await this.repository.fetch(repoRoot, { quiet: true });
          this.lastFetchByRepo.set(repoRoot, Date.now());
          this.onRepositoryChanged();
        }
      }
    } catch (error) {
      nextDelay = Math.max(config.intervalMs, RETRY_AFTER_FAILURE_MS);
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[auto-fetch] ${message}`);
    } finally {
      this.inFlight = false;
      this.schedule(nextDelay);
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private getConfig(): AutoFetchConfig {
    const config = vscode.workspace.getConfiguration('repoFlow.autoFetch');
    const enabled = config.get<boolean>('enabled', true);
    const intervalSeconds = config.get<number>('intervalSeconds', DEFAULT_INTERVAL_MS / 1000);
    const normalizedIntervalSeconds = Number.isFinite(intervalSeconds) ? intervalSeconds : DEFAULT_INTERVAL_MS / 1000;

    return {
      enabled,
      intervalMs: Math.max(MIN_INTERVAL_MS, normalizedIntervalSeconds * 1000)
    };
  }
}
