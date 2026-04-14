import type { CommitDetail, CommitFileChange } from '../../../src/core/models/GitModels';

interface CommitDetailsProps {
    detail: CommitDetail | null;
    repoRoot?: string;
    onOpenDiff: (file: CommitFileChange, detail: CommitDetail) => void;
}

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
});

function formatFullDate(input: string): string {
    return fullDateFormatter.format(new Date(input));
}

// ── File-tree helpers ──────────────────────────────────────────────────────────

interface DirNode {
    children: Map<string, DirNode>;
    files: CommitFileChange[];
}

function buildTree(files: CommitFileChange[]): DirNode {
    const root: DirNode = { children: new Map(), files: [] };
    for (const file of files) {
        const segments = file.path.split('/');
        let node = root;
        for (let i = 0; i < segments.length - 1; i++) {
            const seg = segments[i];
            if (!node.children.has(seg)) {
                node.children.set(seg, { children: new Map(), files: [] });
            }
            node = node.children.get(seg)!;
        }
        node.files.push(file);
    }
    return root;
}

interface FolderGroupProps {
    labelParts: string[];
    node: DirNode;
    depth: number;
    detail: CommitDetail;
    onOpenDiff: (file: CommitFileChange, detail: CommitDetail) => void;
}

function FolderGroup({ labelParts, node, depth, detail, onOpenDiff }: FolderGroupProps) {
    // Path compression: collapse single-child-dir nodes that have no direct files
    if (node.files.length === 0 && node.children.size === 1) {
        const [childName, childNode] = [...node.children.entries()][0];
        return (
            <FolderGroup
                labelParts={[...labelParts, childName]}
                node={childNode}
                depth={depth}
                detail={detail}
                onOpenDiff={onOpenDiff}
            />
        );
    }

    const label = labelParts.join(' / ');
    const groupClass = depth === 0 ? 'tree-group' : 'tree-subgroup';

    return (
        <div className={groupClass}>
            {label && (
                <span className="tree-folder">
                    <i className="codicon codicon-folder" aria-hidden="true" />
                    {label}
                </span>
            )}
            {node.files.map((file) => {
                const filename = file.path.split('/').at(-1) ?? file.path;
                const origFilename = file.originalPath ? (file.originalPath.split('/').at(-1) ?? file.originalPath) : null;
                return (
                    <button
                        key={`${detail.hash}-${file.path}`}
                        type="button"
                        className="file-card"
                        onClick={() => onOpenDiff(file, detail)}
                    >
                        <i className="codicon codicon-file" aria-hidden="true" />
                        <span className={`status-badge status-badge--${file.status.toLowerCase()}`}>{file.status}</span>
                        <span className="file-card__path">
                            {origFilename ? <span className="file-card__rename">{origFilename} → </span> : null}
                            <strong>{filename}</strong>
                        </span>
                        <span className="file-card__stats">
                            <span className="file-card__stats--add">+{file.additions}</span>
                            <span className="file-card__stats--del">−{file.deletions}</span>
                        </span>
                    </button>
                );
            })}
            {[...node.children.entries()].map(([name, child]) => (
                <FolderGroup
                    key={name}
                    labelParts={[name]}
                    node={child}
                    depth={depth + 1}
                    detail={detail}
                    onOpenDiff={onOpenDiff}
                />
            ))}
        </div>
    );
}

export function CommitDetails({ detail, onOpenDiff }: CommitDetailsProps) {
    if (!detail) {
        return (
            <section className="details panel">
                <header className="panel__header">
                    <div>
                        <span className="panel__eyebrow">Commit Details</span>
                        <h2>Select a commit</h2>
                    </div>
                </header>
                <div className="empty-state">Choose a commit in the graph to inspect files, stats and native diffs.</div>
            </section>
        );
    }

    return (
        <section className="details panel">
            <header className="panel__header panel__header--stacked">
                <div>
                    <span className="panel__eyebrow">Commit Details</span>
                    <h2>{detail.subject}</h2>
                </div>
                <div className="details__meta-grid">
                    <div>
                        <span>Hash</span>
                        <strong title={detail.hash}>{detail.hash.slice(0, 8)}</strong>
                    </div>
                    <div>
                        <span>Author</span>
                        <strong>{detail.authorName}</strong>
                    </div>
                    <div>
                        <span>Date</span>
                        <strong>{formatFullDate(detail.authoredAt)}</strong>
                    </div>
                    <div>
                        <span>Stats</span>
                        <strong>
                            <span className="file-card__stats--add">+{detail.stats.additions}</span>
                            {' '}<span className="file-card__stats--del">−{detail.stats.deletions}</span>
                            {' · '}{detail.stats.filesChanged}f
                        </strong>
                    </div>
                </div>
            </header>

            {detail.body ? <pre className="details__body">{detail.body}</pre> : null}

            <div className="details__files">
                {(() => {
                    const tree = buildTree(detail.files);
                    return (
                        <>
                            {tree.files.map((file) => {
                                const filename = file.path.split('/').at(-1) ?? file.path;
                                const origFilename = file.originalPath ? (file.originalPath.split('/').at(-1) ?? file.originalPath) : null;
                                return (
                                    <button key={`${detail.hash}-${file.path}`} type="button" className="file-card" onClick={() => onOpenDiff(file, detail)}>
                                        <i className="codicon codicon-file" aria-hidden="true" />
                                        <span className={`status-badge status-badge--${file.status.toLowerCase()}`}>{file.status}</span>
                                        <span className="file-card__path">
                                            {origFilename ? <span className="file-card__rename">{origFilename} → </span> : null}
                                            <strong>{filename}</strong>
                                        </span>
                                        <span className="file-card__stats">
                                            <span className="file-card__stats--add">+{file.additions}</span>
                                            <span className="file-card__stats--del">−{file.deletions}</span>
                                        </span>
                                    </button>
                                );
                            })}
                            {[...tree.children.entries()].map(([name, child]) => (
                                <FolderGroup
                                    key={name}
                                    labelParts={[name]}
                                    node={child}
                                    depth={0}
                                    detail={detail}
                                    onOpenDiff={onOpenDiff}
                                />
                            ))}
                        </>
                    );
                })()}
            </div>
        </section>
    );
}
