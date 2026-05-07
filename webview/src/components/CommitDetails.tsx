import { useMemo, useState } from 'react';
import type { CommitAnalysisMode, CommitAnalysisResult, CommitDetail, CommitFileChange } from '../../../src/core/models';

type CommitAnalysisViewState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; result: CommitAnalysisResult }
    | { status: 'error'; message: string };

interface CommitDetailsProps {
    detail: CommitDetail | null;
    repoRoot?: string;
    analysisMode: CommitAnalysisMode;
    analysisState: CommitAnalysisViewState;
    onChangeAnalysisMode: (mode: CommitAnalysisMode) => void;
    onAnalyze: (detail: CommitDetail, mode: CommitAnalysisMode) => void;
    onCopyAnalysis: (result: CommitAnalysisResult) => void;
    onInsertAnalysisNote: (detail: CommitDetail, result: CommitAnalysisResult) => void;
    onOpenDiff: (file: CommitFileChange, detail: CommitDetail) => void;
    onClose: () => void;
}

const ANALYSIS_KEYWORDS = [
    { pattern: /\bbreaking changes?\b/gi, className: 'details__keyword details__keyword--breaking' },
    { pattern: /\brenam(?:e|ed|es|ing)\b/gi, className: 'details__keyword details__keyword--rename' },
    { pattern: /\btests?\b|\btesting\b/gi, className: 'details__keyword details__keyword--test' },
    { pattern: /\brisks?\b|\brisky\b/gi, className: 'details__keyword details__keyword--risk' }
];

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

function renderCommitFile(
    file: CommitFileChange,
    detail: CommitDetail,
    onOpenDiff: (file: CommitFileChange, detail: CommitDetail) => void
) {
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
                {origFilename ? <span className="file-card__rename">{origFilename} {'->'} </span> : null}
                <strong>{filename}</strong>
            </span>
            <span className="file-card__stats">
                <span className="file-card__stats--add">+{file.additions}</span>
                <span className="file-card__stats--del">-{file.deletions}</span>
            </span>
        </button>
    );
}

interface AnalysisSection {
    title: string;
    items: string[];
}

function parseAnalysisSections(content: string): AnalysisSection[] {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return [];
    }

    const sections: AnalysisSection[] = [];
    let current: AnalysisSection | null = null;

    for (const rawLine of normalized.split('\n')) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        const headingMatch = /^(?:##\s+|)(Summary|What Changed|Risks|Validation|Suggested Follow-up):?$/i.exec(line);
        if (headingMatch) {
            current = { title: headingMatch[1], items: [] };
            sections.push(current);
            continue;
        }

        if (!current) {
            continue;
        }

        current.items.push(line.replace(/^[-*]\s+/, ''));
    }

    return sections.filter((section) => section.items.length > 0);
}

function renderStructuredAnalysis(content: string) {
    const sections = parseAnalysisSections(content);
    if (sections.length === 0) {
        return <pre className="details__analysis-content">{highlightAnalysisText(content)}</pre>;
    }

    return (
        <div className="details__analysis-sections">
            {sections.map((section) => (
                <section key={section.title} className="details__analysis-section">
                    <h4>{section.title}</h4>
                    <ul>
                        {section.items.map((item) => <li key={`${section.title}-${item}`}>{highlightAnalysisText(item)}</li>)}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function findKeywordMatch(text: string, startIndex: number): { index: number; length: number; value: string; className: string } | null {
    let bestMatch: { index: number; length: number; value: string; className: string } | null = null;

    for (const keyword of ANALYSIS_KEYWORDS) {
        keyword.pattern.lastIndex = 0;
        const slice = text.slice(startIndex);
        const match = keyword.pattern.exec(slice);
        if (!match || match.index < 0) {
            continue;
        }

        const candidate = {
            index: startIndex + match.index,
            length: match[0].length,
            value: match[0],
            className: keyword.className
        };

        if (!bestMatch || candidate.index < bestMatch.index) {
            bestMatch = candidate;
        }
    }

    return bestMatch;
}

function highlightAnalysisText(text: string) {
    const parts: React.ReactNode[] = [];
    let cursor = 0;

    while (cursor < text.length) {
        const match = findKeywordMatch(text, cursor);
        if (!match) {
            parts.push(text.slice(cursor));
            break;
        }

        if (match.index > cursor) {
            parts.push(text.slice(cursor, match.index));
        }

        parts.push(
            <mark key={`${match.className}-${match.index}`} className={match.className}>
                {match.value}
            </mark>
        );

        cursor = match.index + match.length;
    }

    return parts;
}

function FolderGroup({ labelParts, node, depth, detail, onOpenDiff }: Readonly<FolderGroupProps>) {
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
            {expanded ? (
                <div className="tree-folder__children">
                    {compressed.node.files.map((file) => renderCommitFile(file, detail, onOpenDiff))}
                    {[...compressed.node.children.entries()].map(([name, child]) => (
                        <FolderGroup
                            key={`${detail.hash}-${label}-${name}`}
                            labelParts={[name]}
                            node={child}
                            depth={depth + 1}
                            detail={detail}
                            onOpenDiff={onOpenDiff}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function renderAnalysisContent(state: CommitAnalysisViewState) {
    switch (state.status) {
        case 'loading':
            return <p className="details__analysis-placeholder">Generating analysis from the commit message and diff...</p>;
        case 'error':
            return <p className="details__analysis-error">{state.message}</p>;
        case 'success':
            return (
                <>
                    <div className="details__analysis-meta">
                        <span>{state.result.provider}</span>
                        <span>{new Date(state.result.generatedAt).toLocaleString()}</span>
                        {state.result.contextTruncated ? <span>Diff truncated</span> : null}
                    </div>
                    {renderStructuredAnalysis(state.result.content)}
                </>
            );
        default:
            return <p className="details__analysis-placeholder">Run AI analysis to summarize intent, changed areas, risks, and follow-up checks.</p>;
    }
}

export function CommitDetails({ detail, repoRoot, analysisMode, analysisState, onChangeAnalysisMode, onAnalyze, onCopyAnalysis, onInsertAnalysisNote, onOpenDiff, onClose }: Readonly<CommitDetailsProps>) {
    const tree = useMemo(() => detail ? buildTree(detail.files) : null, [detail]);
    const [analysisExpanded, setAnalysisExpanded] = useState(true);
    const [filesExpanded, setFilesExpanded] = useState(false);

    if (!detail || !tree) {
        return null;
    }

    const analysisButtonLabel = analysisState.status === 'loading'
        ? 'Analyzing...'
        : analysisState.status === 'success'
            ? 'Re-run Analysis'
            : analysisState.status === 'error'
                ? 'Try Again'
                : 'Analyze with AI';

    return (
        <section className="details panel">
            <header className="panel__header panel__header--stacked">
                <div className="details__header-main">
                    <div>
                        <span className="panel__eyebrow">Commit Details</span>
                        <h2>{detail.subject}</h2>
                    </div>
                    <div className="panel__header-actions">
                        <button
                            type="button"
                            className="details__analyze-btn"
                            onClick={() => onAnalyze(detail, analysisMode)}
                            disabled={analysisState.status === 'loading' || !repoRoot}
                            title="Generate AI analysis for this commit"
                        >
                            <i className="codicon codicon-sparkle" aria-hidden="true" />
                            <span>{analysisButtonLabel}</span>
                        </button>
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
                            {' '}<span className="file-card__stats--del">-{detail.stats.deletions}</span>
                            {' | '}{detail.stats.filesChanged} files
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

            <section className="details__analysis" aria-label="AI analysis">
                <div className="details__analysis-header">
                    <div className="details__section-heading">
                        <button
                            type="button"
                            className="details__section-toggle"
                            onClick={() => setAnalysisExpanded((value) => !value)}
                            aria-expanded={analysisExpanded}
                            aria-controls="commit-analysis-panel"
                        >
                            <i className={`codicon ${analysisExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                            <span>
                                <span className="panel__eyebrow">AI Analysis</span>
                                <h3>Commit Review</h3>
                            </span>
                        </button>
                    </div>
                    <div className="details__analysis-controls">
                        <div className="details__analysis-mode-switch" role="tablist" aria-label="Analysis mode">
                            <button
                                type="button"
                                className={`details__analysis-mode-btn${analysisMode === 'executive' ? ' details__analysis-mode-btn--active' : ''}`}
                                onClick={() => onChangeAnalysisMode('executive')}
                            >
                                Executive Summary
                            </button>
                            <button
                                type="button"
                                className={`details__analysis-mode-btn${analysisMode === 'technical' ? ' details__analysis-mode-btn--active' : ''}`}
                                onClick={() => onChangeAnalysisMode('technical')}
                            >
                                Technical Review
                            </button>
                        </div>
                        {analysisState.status === 'success' ? (
                            <div className="details__analysis-actions">
                                <button type="button" className="details__analysis-action-btn" onClick={() => onCopyAnalysis(analysisState.result)}>
                                    <i className="codicon codicon-copy" aria-hidden="true" />
                                    <span>Copy analysis</span>
                                </button>
                                <button type="button" className="details__analysis-action-btn" onClick={() => onInsertAnalysisNote(detail, analysisState.result)}>
                                    <i className="codicon codicon-note" aria-hidden="true" />
                                    <span>Insert into commit note</span>
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
                {analysisExpanded ? (
                    <div id="commit-analysis-panel" className="details__analysis-scroll">
                        {renderAnalysisContent(analysisState)}
                    </div>
                ) : null}
            </section>

            <section className="details__files-section" aria-label="Changed files">
                <div className="details__files-header">
                    <button
                        type="button"
                        className="details__section-toggle"
                        onClick={() => setFilesExpanded((value) => !value)}
                        aria-expanded={filesExpanded}
                        aria-controls="commit-files-panel"
                    >
                        <i className={`codicon ${filesExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                        <span>
                            <span className="panel__eyebrow">Changed Files</span>
                            <h3>Files in this commit</h3>
                        </span>
                    </button>
                    <span className="details__files-count">{detail.stats.filesChanged} files</span>
                </div>

                {filesExpanded ? (
                    <div id="commit-files-panel" className="details__files">
                        {tree.files.map((file) => renderCommitFile(file, detail, onOpenDiff))}
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
                ) : null}
            </section>
        </section>
    );
}
