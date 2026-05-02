export interface RepoRemote {
  name: string;
  url: string;
}

export interface RepoGitConfig {
  userName: string;
  userEmail: string;
  hooksPath: string;
  hookScripts: string[];
  remotes: RepoRemote[];
}
