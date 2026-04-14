import type { CSSProperties, MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CommitSummary, GraphSnapshot } from '../../../src/core/models/GitModels';

interface GraphCanvasProps {
    snapshot: GraphSnapshot;
    selectedCommitHash?: string;
    onSelectCommit: (commit: CommitSummary) => void;
    onOpenContextMenu: (commit: CommitSummary, point: { x: number; y: number }) => void;
    onLoadMore: (limit: number) => void;
}

const PALETTE = ['#22c55e', '#38bdf8', '#f59e0b', '#fb7185', '#a78bfa', '#14b8a6', '#f97316', '#84cc16'];

function formatDate(input: string): string {
    return new Intl.DateTimeFormat(undefined, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(input));
}

function getLaneColor(lane: number): string {
    return PALETTE[lane % PALETTE.length];
}

export function GraphCanvas({ snapshot, selectedCommitHash, onSelectCommit, onOpenContextMenu, onLoadMore }: GraphCanvasProps) {
    const rowHeight = 54;
    const laneGap = 26;
    const graphWidth = Math.max(140, 72 + (snapshot.maxLane + 1) * laneGap);
    const totalHeight = snapshot.rows.length * rowHeight;

    const viewportRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);

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
                    strokeOpacity={0.9}
                    strokeWidth={2.5}
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
            <g key={row.commit.hash}>
                <circle cx={x} cy={y} r={isSelected ? 9 : 7} fill={getLaneColor(row.lane)} stroke="#f8fafc" strokeWidth={isSelected ? 3 : 2} />
                {row.commit.isHead ? <circle cx={x} cy={y} r={12} fill="none" stroke="#f8fafc" strokeOpacity={0.8} strokeWidth={1.5} /> : null}
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
                                    title={`${row.commit.subject}\n${row.commit.authorName} · ${new Date(row.commit.authoredAt).toLocaleString()}`}
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
        </section>
    );
}
