import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommitSummary, GraphSnapshot } from '../../../src/core/models/GitModels';

interface GraphCanvasProps {
    snapshot: GraphSnapshot;
    selectedCommitHash?: string;
    selectedUncommitted: boolean;
    onSelectCommit: (commit: CommitSummary) => void;
    onSelectUncommitted: () => void;
    onOpenContextMenu: (commit: CommitSummary, point: { x: number; y: number }) => void;
    onLoadMore: (limit: number) => void;
    onOpenSettings: () => void;
    onOpenPR: () => void;
    onOpenDeleteBranches: () => void;
    onOpenStashModal: () => void;
    onOpenWorktreeModal: () => void;
}

interface HoverTooltip {
    commit: CommitSummary;
    x: number;
    y: number;
}

function CommitHoverTooltip({ data, onEnter, onLeave }: {
    data: HoverTooltip;
    onEnter: () => void;
    onLeave: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', left: data.x, top: data.y });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const padding = 8;
        let left = data.x;
        let top = data.y;
        if (left + rect.width + padding > window.innerWidth) left = window.innerWidth - rect.width - padding;
        if (left < padding) left = padding;
        if (top + rect.height + padding > window.innerHeight) top = data.y - rect.height - 24;
        if (top < padding) top = padding;
        setStyle({ visibility: 'visible', left, top });
    }, [data.x, data.y]);

    const branches = data.commit.refs.filter((r) => r.type === 'localBranch' || r.type === 'remoteBranch');
    const tags = data.commit.refs.filter((r) => r.type === 'tag');

    return (
        <div
            ref={ref}
            className="commit-hover-tooltip"
            style={style}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
        >
            <div className="commit-hover-tooltip__title">Commit {data.commit.shortHash}</div>
            {data.commit.isHead && (
                <div className="commit-hover-tooltip__head-row">
                    This commit is included in <span className="ref-pill ref-pill--head">HEAD</span>
                </div>
            )}
            {branches.length > 0 && (
                <div className="commit-hover-tooltip__section">
                    <span className="commit-hover-tooltip__label">Branches:</span>
                    <div className="commit-hover-tooltip__pills">
                        {branches.map((ref) => (
                            <span key={ref.name} className={`ref-pill ref-pill--${ref.type}`}>{ref.name}</span>
                        ))}
                    </div>
                </div>
            )}
            {tags.length > 0 && (
                <div className="commit-hover-tooltip__section">
                    <span className="commit-hover-tooltip__label">Tags:</span>
                    <div className="commit-hover-tooltip__pills">
                        {tags.map((ref) => (
                            <span key={ref.name} className="ref-pill ref-pill--tag">{ref.name}</span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

const PALETTE = ['#22c55e', '#38bdf8', '#f59e0b', '#fb7185', '#a78bfa', '#14b8a6', '#f97316', '#84cc16'];

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
});

function formatDate(input: string): string {
    return shortDateFormatter.format(new Date(input));
}

function getLaneColor(lane: number): string {
    return PALETTE[lane % PALETTE.length];
}

function buildSearchPattern(query: string, caseSensitive: boolean, wholeWord: boolean, useRegex: boolean): RegExp | null {
    if (!query) return null;
    try {
        const flags = caseSensitive ? 'g' : 'gi';
        const escaped = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const source = wholeWord ? `\\b${escaped}\\b` : escaped;
        return new RegExp(source, flags);
    } catch {
        return null;
    }
}

function highlightText(text: string, pattern: RegExp | null): ReactNode {
    if (!pattern || !text) return text;
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    const re = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
        parts.push(<mark key={match.index} className="find-highlight">{match[0]}</mark>);
        lastIndex = match.index + match[0].length;
        if (match[0].length === 0) { re.lastIndex++; }
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return <>{parts}</>;
}

export function GraphCanvas({ snapshot, selectedCommitHash, selectedUncommitted, onSelectCommit, onSelectUncommitted, onOpenContextMenu, onLoadMore, onOpenSettings, onOpenPR, onOpenDeleteBranches, onOpenStashModal, onOpenWorktreeModal }: GraphCanvasProps) {
    const rowHeight = 46;
    const laneGap = 20;
    const graphWidth = Math.max(110, 52 + (snapshot.maxLane + 1) * laneGap);
    const totalChanges = snapshot.localChanges.staged.length + snapshot.localChanges.unstaged.length + snapshot.localChanges.conflicted.length;
    const hasUncommitted = totalChanges > 0;
    const uncommittedOffset = hasUncommitted ? rowHeight : 0;
    const totalHeight = snapshot.rows.length * rowHeight + uncommittedOffset;
    const uncommittedHeadRow = hasUncommitted ? snapshot.rows.find((r) => r.commit.isHead) : undefined;
    const uncommittedLane = uncommittedHeadRow?.lane ?? 0;
    const uncommittedNodeX = 32 + uncommittedLane * laneGap;
    const uncommittedNodeY = rowHeight / 2;
    const uncommittedEdgeEndY = uncommittedOffset + (uncommittedHeadRow?.row ?? 0) * rowHeight + rowHeight / 2;
    const uncommittedEdgeMidY = uncommittedNodeY + (uncommittedEdgeEndY - uncommittedNodeY) / 2;

    const viewportRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hoverTooltip, setHoverTooltip] = useState<HoverTooltip | null>(null);

    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const handleNodeMouseEnter = useCallback((event: MouseEvent<SVGGElement>, commit: CommitSummary) => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        setHoverTooltip({ commit, x: event.clientX + 14, y: event.clientY + 18 });
    }, []);

    const handleNodeMouseLeave = useCallback(() => {
        hoverTimerRef.current = setTimeout(() => setHoverTooltip(null), 100);
    }, []);

    useEffect(() => {
        loadingRef.current = false;
    }, [snapshot]);

    const handleScroll = useCallback(() => {
        if (!viewportRef.current || !snapshot.hasMore || loadingRef.current) {
            return;
        }
        const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
        if (scrollTop + clientHeight >= scrollHeight - 300) {
            loadingRef.current = true;
            onLoadMore(snapshot.filters.limit + 200);
        }
    }, [snapshot.hasMore, snapshot.filters.limit, onLoadMore]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) {
            return;
        }
        viewport.addEventListener('scroll', handleScroll);
        return () => viewport.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    const rowByHash = useMemo(() => {
        return new Map(snapshot.rows.map((row) => [row.commit.hash, row.row]));
    }, [snapshot.rows]);

    const searchPattern = useMemo(
        () => buildSearchPattern(searchQuery, caseSensitive, wholeWord, useRegex),
        [searchQuery, caseSensitive, wholeWord, useRegex]
    );

    const matchedRows = useMemo(() => {
        if (!searchPattern) return [];
        return snapshot.rows.filter((row) => {
            const fields = [
                row.commit.subject,
                row.commit.shortHash,
                row.commit.hash,
                row.commit.authorName,
                formatDate(row.commit.authoredAt),
                ...row.commit.refs.map((r) => r.name)
            ];
            return fields.some((f) => { searchPattern.lastIndex = 0; return searchPattern.test(f); });
        });
    }, [searchPattern, snapshot.rows]);

    const matchIndexByHash = useMemo(() => {
        const map = new Map<string, number>();
        matchedRows.forEach((row, i) => map.set(row.commit.hash, i));
        return map;
    }, [matchedRows]);

    const edges = snapshot.rows.flatMap((row) => {
        return row.connections.map((connection) => {
            const parentRow = rowByHash.get(connection.parentHash);
            if (parentRow === undefined) {
                return null;
            }

            const startX = 32 + row.lane * laneGap;
            const endX = 32 + connection.lane * laneGap;
            const startY = row.row * rowHeight + rowHeight / 2;
            const endY = parentRow * rowHeight + rowHeight / 2;
            const midY = startY + (endY - startY) / 2;

            const path =
                startX === endX
                    ? `M ${startX} ${startY} L ${endX} ${endY}`
                    : `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;

            return (
                <path
                    key={`${row.commit.hash}-${connection.parentHash}`}
                    d={path}
                    fill="none"
                    stroke={getLaneColor(connection.lane)}
                    strokeOpacity={0.85}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                />
            );
        });
    });

    const nodes = snapshot.rows.map((row) => {
        const x = 32 + row.lane * laneGap;
        const y = row.row * rowHeight + rowHeight / 2;
        const isSelected = row.commit.hash === selectedCommitHash;

        return (
            <g
                key={row.commit.hash}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectCommit(row.commit)}
                onMouseEnter={(event) => handleNodeMouseEnter(event, row.commit)}
                onMouseLeave={handleNodeMouseLeave}
            >
                <circle cx={x} cy={y} r={12} fill="transparent" />
                <circle cx={x} cy={y} r={isSelected ? 6 : 4.5} fill={getLaneColor(row.lane)} stroke="#f8fafc" strokeWidth={isSelected ? 2 : 1.5} />
                {row.commit.isHead ? <circle cx={x} cy={y} r={9} fill="none" stroke="#f8fafc" strokeOpacity={0.75} strokeWidth={1} /> : null}
            </g>
        );
    });

    const handleContextMenu = (event: MouseEvent<HTMLButtonElement>, commit: CommitSummary): void => {
        event.preventDefault();
        onOpenContextMenu(commit, { x: event.clientX, y: event.clientY });
    };

    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                setSearchOpen(true);
                setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }, 0);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => { setCurrentMatchIndex(0); }, [searchQuery, caseSensitive, wholeWord, useRegex]);

    useEffect(() => {
        if (matchedRows.length === 0 || !viewportRef.current) return;
        const match = matchedRows[currentMatchIndex % matchedRows.length];
        if (!match) return;
        const el = viewportRef.current.querySelector(`[data-hash="${match.commit.hash}"]`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentMatchIndex, matchedRows]);

    const closeSearch = useCallback(() => { setSearchOpen(false); setSearchQuery(''); }, []);
    const nextMatch = useCallback(() => {
        if (matchedRows.length === 0) return;
        setCurrentMatchIndex((i) => (i + 1) % matchedRows.length);
    }, [matchedRows.length]);
    const prevMatch = useCallback(() => {
        if (matchedRows.length === 0) return;
        setCurrentMatchIndex((i) => (i - 1 + matchedRows.length) % matchedRows.length);
    }, [matchedRows.length]);
    const handleFindKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) prevMatch(); else nextMatch(); }
        else if (e.key === 'Escape') { closeSearch(); }
    }, [nextMatch, prevMatch, closeSearch]);

    return (
        <section className="graph panel">
            <header className="panel__header">
                <div>
                    <span className="panel__eyebrow">Commit Graph</span>
                    <h2>History</h2>
                </div>
                <div className="panel__header-actions">
                    <button
                        type="button"
                        className="panel__settings-btn"
                        onClick={onOpenPR}
                        title="Create Pull Request"
                        aria-label="Create Pull Request"
                    >
                        <i className="codicon codicon-git-pull-request-create" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="panel__settings-btn"
                        onClick={onOpenWorktreeModal}
                        title="Worktree Manager"
                        aria-label="Worktree Manager"
                    >
                        <i className="codicon codicon-repo-clone" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="panel__settings-btn"
                        onClick={onOpenStashModal}
                        title="Git Stash"
                        aria-label="Git Stash"
                    >
                        <i className="codicon codicon-archive" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="panel__settings-btn"
                        onClick={onOpenDeleteBranches}
                        title="Delete Local Branches"
                        aria-label="Delete Local Branches"
                    >
                        <i className="codicon codicon-trash" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="panel__settings-btn"
                        onClick={onOpenSettings}
                        title="Repository Settings"
                        aria-label="Repository Settings"
                    >
                        <i className="codicon codicon-settings-gear" aria-hidden="true" />
                    </button>
                </div>
            </header>

            {searchOpen && (
                <div className="find-bar" role="search">
                    <div className="find-bar__search-wrap">
                        <i className="codicon codicon-search find-bar__search-icon" aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            className="find-bar__input"
                            type="text"
                            placeholder="Find in history…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleFindKeyDown}
                            aria-label="Find in commit history"
                            spellCheck={false}
                        />
                    </div>
                    <div className="find-bar__opts" role="group" aria-label="Search options">
                        <button type="button" className={`find-bar__opt${caseSensitive ? ' find-bar__opt--on' : ''}`} title="Match Case (Alt+C)" onClick={() => setCaseSensitive((v) => !v)} aria-pressed={caseSensitive}>Aa</button>
                        <div className="find-bar__divider" />
                        <button type="button" className={`find-bar__opt${wholeWord ? ' find-bar__opt--on' : ''}`} title="Match Whole Word (Alt+W)" onClick={() => setWholeWord((v) => !v)} aria-pressed={wholeWord}>ab</button>
                        <div className="find-bar__divider" />
                        <button type="button" className={`find-bar__opt${useRegex ? ' find-bar__opt--on' : ''}`} title="Use Regular Expression (Alt+R)" onClick={() => setUseRegex((v) => !v)} aria-pressed={useRegex}>.*</button>
                    </div>
                    <span className="find-bar__count" aria-live="polite">
                        {searchQuery
                            ? (matchedRows.length === 0 ? 'No results' : `${currentMatchIndex + 1} / ${matchedRows.length}`)
                            : '\u00a0'}
                    </span>
                    <div className="find-bar__nav-group">
                        <button type="button" className="find-bar__nav" onClick={prevMatch} title="Previous Match (Shift+Enter)" disabled={matchedRows.length === 0}>
                            <i className="codicon codicon-arrow-up" aria-hidden="true" />
                        </button>
                        <button type="button" className="find-bar__nav" onClick={nextMatch} title="Next Match (Enter)" disabled={matchedRows.length === 0}>
                            <i className="codicon codicon-arrow-down" aria-hidden="true" />
                        </button>
                    </div>
                    <button type="button" className="find-bar__close" onClick={closeSearch} title="Close (Escape)" aria-label="Close search">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </div>
            )}

            <div className="graph__viewport" ref={viewportRef}>
                <div className="graph__canvas" style={{ '--graph-width': `${graphWidth}px` } as CSSProperties}>
                    <svg className="graph__svg" width={graphWidth} height={totalHeight} viewBox={`0 0 ${graphWidth} ${totalHeight}`} preserveAspectRatio="none" role="img" aria-label="Git graph canvas">
                        <defs>
                            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148, 163, 184, 0.12)" strokeWidth="1" />
                            </pattern>
                        </defs>
                        <rect x="0" y="0" width={graphWidth} height={totalHeight} fill="url(#grid)" />
                        {hasUncommitted && (
                            <>
                                {uncommittedHeadRow !== undefined && (
                                    <path
                                        d={`M ${uncommittedNodeX} ${uncommittedNodeY} C ${uncommittedNodeX} ${uncommittedEdgeMidY}, ${uncommittedNodeX} ${uncommittedEdgeMidY}, ${uncommittedNodeX} ${uncommittedEdgeEndY}`}
                                        fill="none"
                                        stroke={getLaneColor(uncommittedLane)}
                                        strokeOpacity={0.85}
                                        strokeWidth={1.5}
                                        strokeDasharray="4 3"
                                        strokeLinecap="round"
                                    />
                                )}
                                <circle cx={uncommittedNodeX} cy={uncommittedNodeY} r={12} fill="transparent" onClick={onSelectUncommitted} style={{ cursor: 'pointer' }} />
                                <circle cx={uncommittedNodeX} cy={uncommittedNodeY} r={selectedUncommitted ? 6 : 4.5} fill="none" stroke={getLaneColor(uncommittedLane)} strokeWidth={selectedUncommitted ? 2 : 1.5} />
                            </>
                        )}
                        <g transform={`translate(0, ${uncommittedOffset})`}>
                            {edges}
                            {nodes}
                        </g>
                    </svg>

                    <div className="graph__rows">
                        {hasUncommitted && (
                            <button
                                type="button"
                                className={`graph-row${selectedUncommitted ? ' graph-row--selected' : ''}`}
                                onClick={onSelectUncommitted}
                            >
                                <div className="graph-row__title-line">
                                    <span className="graph-row__subject">Uncommitted Changes ({totalChanges})</span>
                                </div>
                                <div className="graph-row__meta">
                                    <span>*</span>
                                    <span>*</span>
                                </div>
                            </button>
                        )}
                        {snapshot.rows.map((row) => {
                            const isSelected = row.commit.hash === selectedCommitHash;
                            const matchIdx = matchIndexByHash.get(row.commit.hash);
                            const isMatch = matchIdx !== undefined;
                            const isCurrentMatch = matchIdx === currentMatchIndex && isMatch;
                            const rowClass = [
                                'graph-row',
                                isSelected ? 'graph-row--selected' : '',
                                isMatch ? 'graph-row--match' : '',
                                isCurrentMatch ? 'graph-row--match-current' : ''
                            ].filter(Boolean).join(' ');
                            return (
                                <button
                                    key={row.commit.hash}
                                    data-hash={row.commit.hash}
                                    type="button"
                                    className={rowClass}
                                    onClick={() => onSelectCommit(row.commit)}
                                    onContextMenu={(event) => handleContextMenu(event, row.commit)}
                                >
                                    <div className="graph-row__title-line">
                                        <span className="graph-row__subject">{highlightText(row.commit.subject, searchPattern)}</span>
                                        {row.commit.refs.map((ref) => (
                                            <span key={`${row.commit.hash}-${ref.type}-${ref.name}`} className={`ref-pill ref-pill--${ref.type}`}>
                                                {highlightText(ref.name, searchPattern)}
                                            </span>
                                        ))}
                                        {row.commit.isDirtyHead ? <span className="ref-pill ref-pill--dirty">dirty</span> : null}
                                    </div>

                                    <div className="graph-row__meta">
                                        <span>{highlightText(row.commit.shortHash, searchPattern)}</span>
                                        <span>{highlightText(row.commit.authorName, searchPattern)}</span>
                                        <span>{highlightText(formatDate(row.commit.authoredAt), searchPattern)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {hoverTooltip && (
                <CommitHoverTooltip
                    data={hoverTooltip}
                    onEnter={() => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }}
                    onLeave={() => setHoverTooltip(null)}
                />
            )}
        </section>
    );
}
