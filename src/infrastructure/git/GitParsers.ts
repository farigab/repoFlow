import type {
    BranchSummary,
    CommitDetail,
    CommitFileChange,
    CommitSummary,
    GitRef,
    WorkingTreeFile,
    WorkingTreeStatus
} from '../../core/models/GitModels';

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
      const [name, targetHash, upstream, headMarker, tracking] = line.split(FIELD_SEPARATOR);
      const remote = name.startsWith('origin/') || name.startsWith('refs/remotes/');
      const shortName = name.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');

      return {
        name,
        shortName,
        remote,
        current: headMarker === '*',
        targetHash,
        upstream: upstream || undefined,
        tracking: tracking || undefined
      } satisfies BranchSummary;
    })
    .filter((branch) => branch.shortName !== 'HEAD');
}

function parseStatusLine(line: string): WorkingTreeFile | undefined {
  if (line.startsWith('1 ') || line.startsWith('2 ')) {
    const parts = line.split(' ');
    const xy = parts[1] ?? '..';
    const pathSegment = line.split('\t');
    const path = pathSegment[pathSegment.length - 1] ?? '';
    const originalPath = line.startsWith('2 ') ? pathSegment[pathSegment.length - 2] : undefined;

    return {
      path,
      originalPath,
      indexStatus: xy[0] ?? '.',
      workTreeStatus: xy[1] ?? '.',
      conflicted: false
    };
  }

  if (line.startsWith('u ')) {
    const parts = line.split(' ');
    const xy = parts[1] ?? 'UU';
    const path = line.split('\t').pop() ?? '';

    return {
      path,
      indexStatus: xy[0] ?? 'U',
      workTreeStatus: xy[1] ?? 'U',
      conflicted: true
    };
  }

  if (line.startsWith('?')) {
    const path = line.slice(2).trim();
    return {
      path,
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
