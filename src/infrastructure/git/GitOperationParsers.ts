import type {
  BranchCompareCommit,
  BranchCompareFile,
  StashEntry,
  StashFile,
  UndoEntry
} from '../../core/models';

export function escapePathSpec(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

export function parseStashList(raw: string): StashEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const entries: StashEntry[] = [];
  for (const record of raw.split('\x1e')) {
    const trimmed = record.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split('\x1f');
    if (parts.length < 3) {
      continue;
    }

    const ref = parts[0].trim();
    const subject = parts[1].trim();
    const date = parts[2].trim();

    const indexMatch = /stash@\{(\d+)\}/.exec(ref);
    const index = indexMatch ? Number.parseInt(indexMatch[1], 10) : 0;

    const branchMatch = /^(?:WIP on|On) ([^:]+):/.exec(subject);
    const branch = branchMatch ? branchMatch[1].trim() : '';

    entries.push({ index, ref, message: subject, branch, date, files: [] });
  }

  return entries;
}

export function parseStashFiles(raw: string): StashFile[] {
  const parts = raw.split('\0').filter(Boolean);
  const files: StashFile[] = [];

  for (let index = 0; index < parts.length;) {
    const rawStatus = parts[index++]?.trim();
    if (!rawStatus) {
      continue;
    }

    const status = rawStatus.replaceAll(/\d+/g, '') || rawStatus;

    if (status.startsWith('R') || status.startsWith('C')) {
      const originalPath = parts[index++];
      const filePath = parts[index++];
      if (filePath) {
        files.push({ path: filePath, originalPath, status: status[0] });
      }
      continue;
    }

    const filePath = parts[index++];
    if (filePath) {
      files.push({ path: filePath, status: status[0] ?? status });
    }
  }

  return files;
}

export function parseCompareCommits(raw: string): BranchCompareCommit[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', authorName = '', authoredAt = '', subject = ''] = record.split('\x1f');
      return {
        hash,
        shortHash: hash.slice(0, 8),
        authorName,
        authoredAt,
        subject
      };
    })
    .filter((commit) => commit.hash.length > 0);
}

export function parseNameStatusAndNumstat(nameStatusRaw: string, numstatRaw: string): BranchCompareFile[] {
  const files: BranchCompareFile[] = [];
  const numstatByPath = new Map<string, { additions: number; deletions: number }>();

  for (const line of numstatRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [rawAdditions, rawDeletions, pathA, pathB] = trimmed.split('\t');
    const additions = rawAdditions === '-' ? 0 : Number.parseInt(rawAdditions ?? '0', 10);
    const deletions = rawDeletions === '-' ? 0 : Number.parseInt(rawDeletions ?? '0', 10);
    const key = pathB ?? pathA;
    if (key) {
      numstatByPath.set(key, { additions: Number.isFinite(additions) ? additions : 0, deletions: Number.isFinite(deletions) ? deletions : 0 });
    }
  }

  for (const line of nameStatusRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [rawStatus, pathA, pathB] = trimmed.split('\t');
    if (!rawStatus || !pathA) {
      continue;
    }

    const status = rawStatus[0] ?? rawStatus;
    const finalPath = pathB ?? pathA;
    const stats = numstatByPath.get(finalPath) ?? { additions: 0, deletions: 0 };
    files.push({
      status,
      path: finalPath,
      originalPath: pathB ? pathA : undefined,
      additions: stats.additions,
      deletions: stats.deletions
    });
  }

  return files;
}

export function parseUndoEntries(raw: string): UndoEntry[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', ref = '', date = '', message = ''] = record.split('\x1f');
      return { hash, shortHash: hash.slice(0, 8), ref, date, message };
    })
    .filter((entry) => entry.hash.length > 0 && entry.ref.length > 0);
}
