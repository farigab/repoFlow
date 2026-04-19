import type {
  BlameEntry,
  BranchSummary,
  CommitDetail,
  CommitFileChange,
  CommitStats,
  CommitSummary,
  GitRef,
  WorkingTreeFile,
  WorkingTreeStatus,
  WorktreeEntry
} from '../../core/models';

const RECORD_SEPARATOR = '\u001e';
const FIELD_SEPARATOR = '\u001f';

function parseRefs(rawRefs: string): GitRef[] {
  return rawRefs
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map<GitRef>((ref) => {
      if (ref === 'HEAD' || ref.startsWith('HEAD ->')) {
        return { name: ref.replace('HEAD ->', '').trim() || 'HEAD', type: 'head' };
      }

      if (ref.startsWith('tag:')) {
        return { name: ref.replace(/^tag:\s*/, '').replace(/^refs\/tags\//, ''), type: 'tag' };
      }

      if (ref.startsWith('refs/remotes/')) {
        return { name: ref.replace('refs/remotes/', ''), type: 'remoteBranch' };
      }

      if (ref.startsWith('refs/heads/')) {
        return { name: ref.replace('refs/heads/', ''), type: 'localBranch' };
      }

      return { name: ref, type: 'localBranch' };
    });
}

export function parseCommitLog(raw: string, dirtyHead = false): CommitSummary[] {
  return raw
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, parents, authorName, authorEmail, authoredAt, subject, refsRaw] = record.split(FIELD_SEPARATOR);
      const refs = parseRefs(refsRaw ?? '');
      const isHead = refs.some((ref) => ref.type === 'head');

      return {
        hash,
        shortHash: hash.slice(0, 8),
        parentHashes: parents ? parents.split(' ').filter(Boolean) : [],
        authorName,
        authorEmail,
        authoredAt,
        subject,
        refs,
        isHead,
        isDirtyHead: isHead && dirtyHead
      } satisfies CommitSummary;
    });
}

export function parseBranchList(raw: string): BranchSummary[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, targetHash, upstream, headMarker, track] = line.split('\t');
      const remote = name.startsWith('refs/remotes/');
      const shortName = name.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');

      // track is like "[ahead 2]", "[behind 1]", "[ahead 2, behind 1]" or ""
      const aheadMatch = track ? /ahead (\d+)/.exec(track) : null;
      const behindMatch = track ? /behind (\d+)/.exec(track) : null;

      return {
        name,
        shortName,
        remote,
        current: headMarker === '*',
        targetHash,
        upstream: upstream || undefined,
        ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : undefined,
        behind: behindMatch ? parseInt(behindMatch[1], 10) : undefined
      } satisfies BranchSummary;
    })
    .filter((branch) => branch.shortName !== 'HEAD');
}

function parseStatusLine(line: string): WorkingTreeFile | undefined {
  // Porcelain v2 ordinary entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
  if (line.startsWith('1 ')) {
    const parts = line.split(' ');
    const xy = parts[1] ?? '..';
    const filePath = parts.slice(8).join(' ');

    return {
      path: filePath,
      indexStatus: xy[0] ?? '.',
      workTreeStatus: xy[1] ?? '.',
      conflicted: false
    };
  }

  // Porcelain v2 rename/copy: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\t<origPath>
  if (line.startsWith('2 ')) {
    const parts = line.split(' ');
    const xy = parts[1] ?? '..';
    const rest = parts.slice(9).join(' ');
    const [filePath, originalPath] = rest.split('\t');

    return {
      path: filePath,
      originalPath,
      indexStatus: xy[0] ?? '.',
      workTreeStatus: xy[1] ?? '.',
      conflicted: false
    };
  }

  // Porcelain v2 unmerged: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
  if (line.startsWith('u ')) {
    const parts = line.split(' ');
    const xy = parts[1] ?? 'UU';
    const filePath = parts.slice(10).join(' ');

    return {
      path: filePath,
      indexStatus: xy[0] ?? 'U',
      workTreeStatus: xy[1] ?? 'U',
      conflicted: true
    };
  }

  if (line.startsWith('?')) {
    const filePath = line.slice(2).trim();
    return {
      path: filePath,
      indexStatus: '?',
      workTreeStatus: '?',
      conflicted: false
    };
  }

  return undefined;
}

export function parseWorkingTreeStatus(raw: string): WorkingTreeStatus {
  const status: WorkingTreeStatus = {
    currentBranch: undefined,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    conflicted: []
  };

  raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith('# branch.head ')) {
        status.currentBranch = line.replace('# branch.head ', '').trim();
        return;
      }

      if (line.startsWith('# branch.upstream ')) {
        status.upstream = line.replace('# branch.upstream ', '').trim();
        return;
      }

      if (line.startsWith('# branch.ab ')) {
        const match = /\+(\d+)\s+-(\d+)/.exec(line);
        if (match) {
          status.ahead = Number(match[1]);
          status.behind = Number(match[2]);
        }
        return;
      }

      const file = parseStatusLine(line);
      if (!file) {
        return;
      }

      if (file.conflicted) {
        status.conflicted.push(file);
        return;
      }

      if (file.indexStatus !== '.' && file.indexStatus !== '?') {
        status.staged.push(file);
      }

      if (file.workTreeStatus !== '.' || file.indexStatus === '?') {
        status.unstaged.push(file);
      }
    });

  return status;
}

export function parseCommitDetailHeader(raw: string, dirtyHead = false): CommitDetail {
  const [hash, parents, authorName, authorEmail, authoredAt, subject, body, refsRaw] = raw.trim().split(FIELD_SEPARATOR);
  const refs = parseRefs(refsRaw ?? '');
  const isHead = refs.some((ref) => ref.type === 'head');

  return {
    hash,
    shortHash: hash.slice(0, 8),
    parentHashes: parents ? parents.split(' ').filter(Boolean) : [],
    authorName,
    authorEmail,
    authoredAt,
    subject,
    body: body?.trim() ?? '',
    refs,
    isHead,
    isDirtyHead: isHead && dirtyHead,
    stats: {
      additions: 0,
      deletions: 0,
      filesChanged: 0
    },
    files: []
  };
}

export function parseCommitFiles(numstatRaw: string, nameStatusRaw: string): CommitFileChange[] {
  const fileByKey = new Map<string, CommitFileChange>();

  nameStatusRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [status, firstPath, secondPath] = line.split('\t');
      const normalizedStatus = status.replace(/\d+/g, '');
      const path = secondPath ?? firstPath;

      fileByKey.set(path, {
        path,
        originalPath: secondPath ? firstPath : undefined,
        status: normalizedStatus,
        additions: 0,
        deletions: 0
      });
    });

  numstatRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split('\t');
      const additions = parts[0] === '-' ? 0 : Number(parts[0]);
      const deletions = parts[1] === '-' ? 0 : Number(parts[1]);
      const path = parts[3] ?? parts[2];
      const originalPath = parts[3] ? parts[2] : undefined;
      const existing = fileByKey.get(path);

      fileByKey.set(path, {
        path,
        originalPath: existing?.originalPath ?? originalPath,
        status: existing?.status ?? 'M',
        additions,
        deletions
      });
    });

  return Array.from(fileByKey.values()).sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Parses the output of `git blame --porcelain <file>`.
 * Returns entries indexed 0-based (entries[0] = line 1).
 */
export function parseBlameOutput(raw: string): BlameEntry[] {
  const lines = raw.split('\n');
  const commitMeta = new Map<string, Omit<BlameEntry, 'lineNumber'>>();
  const entries: BlameEntry[] = [];

  let i = 0;
  while (i < lines.length) {
    // Header line: <40-char hash> <orig-lineno> <final-lineno> [<num-lines>]
    const headerMatch = /^([0-9a-f]{40}) \d+ (\d+)/.exec(lines[i] ?? '');
    if (!headerMatch) {
      i++;
      continue;
    }

    const hash = headerMatch[1];
    const finalLine = parseInt(headerMatch[2], 10);
    i++;

    const isFirstOccurrence = !commitMeta.has(hash);
    if (isFirstOccurrence) {
      let authorName = '';
      let authorEmail = '';
      let committedAt = '';
      let commitMessage = '';

      // Parse metadata lines until we hit the content line (starts with \t)
      while (i < lines.length && !(lines[i] ?? '').startsWith('\t')) {
        const meta = lines[i] ?? '';
        if (meta.startsWith('author ') && !meta.startsWith('author-')) {
          authorName = meta.slice(7);
        } else if (meta.startsWith('author-mail ')) {
          authorEmail = meta.slice(12).replace(/[<>]/g, '').trim();
        } else if (meta.startsWith('author-time ')) {
          const unixSec = parseInt(meta.slice(12), 10);
          committedAt = new Date(unixSec * 1000).toISOString();
        } else if (meta.startsWith('summary ')) {
          commitMessage = meta.slice(8);
        }
        i++;
      }

      commitMeta.set(hash, { commitHash: hash, authorName, authorEmail, committedAt, commitMessage });
    } else {
      // Subsequent occurrence: skip metadata until content line
      while (i < lines.length && !(lines[i] ?? '').startsWith('\t')) {
        i++;
      }
    }

    i++; // skip content line

    const meta = commitMeta.get(hash);
    if (meta) {
      entries.push({ ...meta, lineNumber: finalLine });
    }
  }

  entries.sort((a, b) => a.lineNumber - b.lineNumber);
  return entries;
}

/**
 * Parses the output of `git show --format="" --numstat <hash>`.
 */
export function parseNumstatStats(raw: string): CommitStats {
  let insertions = 0;
  let deletions = 0;
  let filesChanged = 0;

  for (const line of raw.split('\n')) {
    const match = /^(\d+)\t(\d+)\t/.exec(line.trim());
    if (match) {
      insertions += parseInt(match[1], 10);
      deletions += parseInt(match[2], 10);
      filesChanged++;
    }
  }

  return { insertions, deletions, filesChanged };
}

/**
 * Parses the output of `git worktree list --porcelain`.
 *
 * Each worktree block is separated by a blank line and looks like:
 * ```
 * worktree /abs/path
 * HEAD <sha1>
 * branch refs/heads/<name>   ← omitted when detached
 * [detached]                 ← present when detached
 * locked [reason]            ← present when locked
 * ```
 * The first block is always the main (primary) worktree.
 * Status fields (dirty/staged/unstaged/ahead/behind) default to 0/false;
 * callers enrich them via parseWorktreeStatusV2.
 */
export function parseWorktreeList(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = raw.trim().split(/\r?\n\r?\n/);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block?.trim()) {
      continue;
    }

    let worktreePath = '';
    let head = '';
    let branch: string | null = null;
    let locked = false;

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        worktreePath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).trim();
      } else if (line.startsWith('locked')) {
        locked = true;
      }
      // 'detached' keyword → branch stays null (already the default)
    }

    if (worktreePath && head) {
      entries.push({ path: worktreePath, head, branch, isMain: i === 0, locked, dirty: false, staged: 0, unstaged: 0, ahead: 0, behind: 0 });
    }
  }

  return entries;
}

/**
 * Parses `git status --porcelain=v2 --branch` output and returns dirty-status fields
 * that can be merged into a WorktreeEntry.
 */
export function parseWorktreeStatusV2(raw: string): Pick<WorktreeEntry, 'dirty' | 'staged' | 'unstaged' | 'ahead' | 'behind'> {
  let staged = 0;
  let unstaged = 0;
  let ahead = 0;
  let behind = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('# branch.ab ')) {
      // Format: # branch.ab +<ahead> -<behind>
      const match = line.match(/\+([0-9]+)\s+-([0-9]+)/);
      if (match) {
        ahead = parseInt(match[1], 10);
        behind = parseInt(match[2], 10);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Format: 1 XY ... or 2 XY ...
      const xy = line.slice(2, 4);
      if (xy[0] && xy[0] !== '.' && xy[0] !== '?') staged++;
      if (xy[1] && xy[1] !== '.' && xy[1] !== '?') unstaged++;
    } else if (line.startsWith('? ') || line.startsWith('u ')) {
      // Untracked / unmerged → always dirty
      unstaged++;
    }
  }

  return { dirty: staged > 0 || unstaged > 0, staged, unstaged, ahead, behind };
}
