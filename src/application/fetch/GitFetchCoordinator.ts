import * as vscode from 'vscode';
import type { GitRepository } from '../../core/ports/GitRepository';

export const DUPLICATE_FETCH_WINDOW_MS = 5_000;
export const FETCH_WATCHER_SUPPRESSION_MS = 2_000;

export interface GitFetchOptions {
  quiet?: boolean;
  reason?: string;
  minimumIntervalMs?: number;
}

export interface GitFetchResult {
  repoRoot: string;
  status: 'fetched' | 'joined' | 'skipped';
}

export class GitFetchCoordinator implements vscode.Disposable {
  private readonly inFlightByRepo = new Map<string, Promise<void>>();
  private readonly lastFetchByRepo = new Map<string, number>();

  public constructor(
    private readonly repository: GitRepository,
    private readonly output: vscode.OutputChannel
  ) { }

  public async fetch(repoRoot: string, options: GitFetchOptions = {}): Promise<GitFetchResult> {
    const inFlight = this.inFlightByRepo.get(repoRoot);
    const reason = options.reason ?? 'fetch';

    if (inFlight) {
      if (!options.quiet) {
        this.output.appendLine(`[fetch:${reason}] Reusing in-flight fetch for ${repoRoot}`);
      }
      await inFlight;
      return { repoRoot, status: 'joined' };
    }

    const minimumIntervalMs = options.minimumIntervalMs ?? 0;
    const now = Date.now();
    const lastFetchAt = minimumIntervalMs > 0
      ? await this.resolveLastFetchAt(repoRoot)
      : (this.lastFetchByRepo.get(repoRoot) ?? 0);

    if (minimumIntervalMs > 0 && now - lastFetchAt < minimumIntervalMs) {
      if (!options.quiet) {
        const elapsedSeconds = Math.max(0, Math.round((now - lastFetchAt) / 1000));
        this.output.appendLine(`[fetch:${reason}] Skipped duplicate fetch for ${repoRoot}; last fetch was ${elapsedSeconds}s ago.`);
      }
      return { repoRoot, status: 'skipped' };
    }

    const operation = this.repository.fetch(repoRoot, { quiet: options.quiet }).then(() => {
      this.lastFetchByRepo.set(repoRoot, Date.now());
    });

    this.inFlightByRepo.set(repoRoot, operation);
    try {
      await operation;
      return { repoRoot, status: 'fetched' };
    } finally {
      if (this.inFlightByRepo.get(repoRoot) === operation) {
        this.inFlightByRepo.delete(repoRoot);
      }
    }
  }

  public isFetchActiveOrRecentlyCompleted(windowMs = FETCH_WATCHER_SUPPRESSION_MS): boolean {
    if (this.inFlightByRepo.size > 0) {
      return true;
    }

    const now = Date.now();
    for (const lastFetchAt of this.lastFetchByRepo.values()) {
      if (now - lastFetchAt < windowMs) {
        return true;
      }
    }

    return false;
  }

  private async resolveLastFetchAt(repoRoot: string): Promise<number> {
    const cached = this.lastFetchByRepo.get(repoRoot);
    if (cached) {
      return cached;
    }

    try {
      const status = await this.repository.getLocalChanges(repoRoot);
      if (status.lastFetchAt) {
        const parsed = Date.parse(status.lastFetchAt);
        if (Number.isFinite(parsed)) {
          this.lastFetchByRepo.set(repoRoot, parsed);
          return parsed;
        }
      }
    } catch {
      // If status inspection fails, fall back to fetching; the fetch call will
      // surface any actionable Git error to the caller.
    }

    return 0;
  }

  public dispose(): void {
    this.inFlightByRepo.clear();
    this.lastFetchByRepo.clear();
  }
}
