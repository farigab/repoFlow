export interface GitConfigPort {
  setGitUserName(repoRoot: string, name: string): Promise<void>;
  setGitUserEmail(repoRoot: string, email: string): Promise<void>;
  setRemoteUrl(repoRoot: string, remoteName: string, url: string): Promise<void>;
}
