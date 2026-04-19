export interface GitRemotePort {
  fetch(repoRoot: string): Promise<void>;
  pull(repoRoot: string): Promise<void>;
  push(repoRoot: string): Promise<void>;
}
