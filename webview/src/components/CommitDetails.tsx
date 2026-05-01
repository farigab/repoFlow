import { useMemo, useState } from 'react';
import type { CommitDetail, CommitFileChange } from '../../../src/core/models';

interface CommitDetailsProps {
    detail: CommitDetail | null;
    repoRoot?: string;
    onOpenDiff: (file: CommitFileChange, detail: CommitDetail) => void;
    onClose: () => void;
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

function compressFolder(labelParts: string[], node: DirNode): { labelParts: string[]; node: DirNode } {
    let currentLabelParts = labelParts;
    let currentNode = node;

    while (currentNode.files.length === 0 && currentNode.children.size === 1) {
        const [childName, childNode] = [...currentNode.children.entries()][0];
        currentLabelParts = [...currentLabelParts, childName];
        currentNode = childNode;
    }

    return { labelParts: currentLabelParts, node: currentNode };
}

function FolderGroup({ labelParts, node, depth, detail, onOpenDiff }: FolderGroupProps) {
    const compressed = compressFolder(labelParts, node);
    const label = compressed.labelParts.join(' / ');
    const groupClass = depth === 0 ? 'tree-group' : 'tree-subgroup';
    const [expanded, setExpanded] = useState(true);

    return (
        <div className={groupClass}>
            {label && (
                <button
                    type="button"
                    className="tree-folder"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                >
                    <i className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'} tree-folder__chevron`} aria-hidden="true" />
                    <i className={`codicon ${expanded ? 'codicon-folder-opened' : 'codicon-folder'} tree-folder__icon`} aria-hidden="true" />
                    <span>{label}</span>
                </button>
            )}
            {expanded ? compressed.node.files.map((file) => {
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
            }) : null}
            {expanded ? [...compressed.node.children.entries()].map(([name, child]) => (
                <FolderGroup
                    key={`${label}/${name}`}
                    labelParts={[name]}
                    node={child}
                    depth={depth + 1}
                    detail={detail}
                    onOpenDiff={onOpenDiff}
                />
            )) : null}
        </div>
    );
}

export function CommitDetails({ detail, onOpenDiff, onClose }: CommitDetailsProps) {
    const tree = useMemo(() => detail ? buildTree(detail.files) : null, [detail]);

    if (!detail || !tree) {
        return null;
    }

    return (
        <section className="details panel">
            <header className="panel__header panel__header--stacked">
                <div className="details__header-main">
                    <div>
                        <span className="panel__eyebrow">Commit Details</span>
                        <h2>{detail.subject}</h2>
                    </div>
                    <button
                        type="button"
                        className="panel__settings-btn"
                        onClick={onClose}
                        title="Close Commit Details"
                        aria-label="Close Commit Details"
                    >
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </div>
                <div className="details__meta-grid">
                    <div>
                        <span>Hash</span>
                        <strong title={detail.hash}>{detail.hash.slice(0, 8)}</strong>
                    </div>
                    <div>
                        <span>Author</span>
                        <strong>
                            {detail.authorName}
                            <span className="details__author-email">
                                {detail.authorEmail}
                            </span>
                        </strong>
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

            <div className="details__file-summary" aria-label="Commit file summary">
                <span className="details__file-summary-item details__file-summary-item--add">
                    <i className="codicon codicon-add" aria-hidden="true" />
                    {detail.stats.additions} additions
                </span>
                <span className="details__file-summary-item details__file-summary-item--del">
                    <i className="codicon codicon-remove" aria-hidden="true" />
                    {detail.stats.deletions} deletions
                </span>
                <span className="details__file-summary-item">
                    <i className="codicon codicon-files" aria-hidden="true" />
                    {detail.stats.filesChanged} files
                </span>
            </div>

            <div className="details__files">
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
                        key={`${detail.hash}-${name}`}
                        labelParts={[name]}
                        node={child}
                        depth={0}
                        detail={detail}
                        onOpenDiff={onOpenDiff}
                    />
                ))}
            </div>
        </section>
    );
}
