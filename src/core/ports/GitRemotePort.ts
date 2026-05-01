export interface GitRemotePort {
  fetch(repoRoot: string, options?: { quiet?: boolean }): Promise<void>;
  pull(repoRoot: string): Promise<void>;
  push(repoRoot: string): Promise<void>;
}
