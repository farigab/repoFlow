import type { BranchSummary, RepoRemote } from '../../core/models';

export function resolvePreferredRemoteForPullRequest(sourceBranch: string, branches: BranchSummary[], remotes: RepoRemote[]): RepoRemote | undefined {
  if (remotes.length === 0) {
    return undefined;
  }

  const source = branches.find((branch) => !branch.remote && branch.shortName === sourceBranch);
  const upstreamRemoteName = source?.upstream?.split('/')[0];
  if (upstreamRemoteName) {
    const upstreamRemote = remotes.find((remote) => remote.name === upstreamRemoteName);
    if (upstreamRemote) {
      return upstreamRemote;
    }
  }

  const origin = remotes.find((remote) => remote.name === 'origin');
  return origin ?? remotes[0];
}

export function buildPrUrl(remoteUrl: string, source: string, target: string, title: string, description: string): string | null {
  const normalized = remoteUrl
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^git@gitlab\.com:/, 'https://gitlab.com/')
    .replace(/^git@bitbucket\.org:/, 'https://bitbucket.org/')
    .replace(/\.git$/, '');

  const enc = encodeURIComponent;
  const encodedTitle = title ? `&title=${enc(title)}` : '';
  const encodedDescription = description ? `&body=${enc(description)}` : '';

  if (/github\.com/.test(normalized)) {
    const base = `${normalized}/compare/${enc(target)}...${enc(source)}`;
    const params = `?quick_pull=1${encodedTitle}${encodedDescription}`;
    return base + params;
  }

  if (/gitlab\.com/.test(normalized)) {
    const params: string[] = [
      `merge_request[source_branch]=${enc(source)}`,
      `merge_request[target_branch]=${enc(target)}`
    ];
    if (title) {
      params.push(`merge_request[title]=${enc(title)}`);
    }
    if (description) {
      params.push(`merge_request[description]=${enc(description)}`);
    }
    return `${normalized}/-/merge_requests/new?${params.join('&')}`;
  }

  if (/bitbucket\.org/.test(normalized)) {
    const params: string[] = [
      `source=${enc(source)}`,
      `dest=${enc(target)}`
    ];
    if (title) params.push(`title=${enc(title)}`);
    if (description) params.push(`description=${enc(description)}`);
    return `${normalized}/pull-requests/new?${params.join('&')}`;
  }

  return null;
}
