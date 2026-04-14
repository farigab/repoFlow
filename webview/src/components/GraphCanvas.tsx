import type { CSSProperties, MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommitSummary, GraphSnapshot } from '../../../src/core/models/GitModels';

interface GraphCanvasProps {
    snapshot: GraphSnapshot;
    selectedCommitHash?: string;
    onSelectCommit: (commit: CommitSummary) => void;
    onOpenContextMenu: (commit: CommitSummary, point: { x: number; y: number }) => void;
    onLoadMore: (limit: number) => void;
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

export function GraphCanvas({ snapshot, selectedCommitHash, onSelectCommit, onOpenContextMenu, onLoadMore }: GraphCanvasProps) {
    const rowHeight = 40;
    const laneGap = 20;
    const graphWidth = Math.max(110, 52 + (snapshot.maxLane + 1) * laneGap);
    const totalHeight = snapshot.rows.length * rowHeight;

    const viewportRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hoverTooltip, setHoverTooltip] = useState<HoverTooltip | null>(null);

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

    return (
        <section className="graph panel">
            <header className="panel__header">
                <div>
                    <span className="panel__eyebrow">Commit Graph</span>
                    <h2>History</h2>
                </div>
            </header>

            <div className="graph__viewport" ref={viewportRef}>
                <div className="graph__canvas" style={{ '--graph-width': `${graphWidth}px` } as CSSProperties}>
                    <svg className="graph__svg" width={graphWidth} height={totalHeight} viewBox={`0 0 ${graphWidth} ${totalHeight}`} role="img" aria-label="Git graph canvas">
                        <defs>
                            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148, 163, 184, 0.12)" strokeWidth="1" />
                            </pattern>
                        </defs>
                        <rect x="0" y="0" width={graphWidth} height={totalHeight} fill="url(#grid)" />
                        {edges}
                        {nodes}
                    </svg>

                    <div className="graph__rows">
                        {snapshot.rows.map((row) => {
                            const isSelected = row.commit.hash === selectedCommitHash;
                            return (
                                <button
                                    key={row.commit.hash}
                                    type="button"
                                    className={`graph-row${isSelected ? ' graph-row--selected' : ''}`}
                                    onClick={() => onSelectCommit(row.commit)}
                                    onContextMenu={(event) => handleContextMenu(event, row.commit)}
                                >
                                    <div className="graph-row__title-line">
                                        <span className="graph-row__subject">{row.commit.subject}</span>
                                        {row.commit.refs.map((ref) => (
                                            <span key={`${row.commit.hash}-${ref.type}-${ref.name}`} className={`ref-pill ref-pill--${ref.type}`}>
                                                {ref.name}
                                            </span>
                                        ))}
                                        {row.commit.isDirtyHead ? <span className="ref-pill ref-pill--dirty">dirty</span> : null}
                                    </div>

                                    <div className="graph-row__meta">
                                        <span>{row.commit.shortHash}</span>
                                        <span>{row.commit.authorName}</span>
                                        <span>{formatDate(row.commit.authoredAt)}</span>
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
