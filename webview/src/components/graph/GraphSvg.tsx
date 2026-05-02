import type { MouseEvent } from 'react';
import { useMemo } from 'react';
import type { CommitSummary, GraphSnapshot } from '../../../../src/core/models';
import { getLaneColor, GRAPH_LANE_GAP, GRAPH_ROW_HEIGHT } from './graphUtils';

interface GraphSvgProps {
    snapshot: GraphSnapshot;
    graphWidth: number;
    totalHeight: number;
    hasUncommitted: boolean;
    selectedCommitHash?: string;
    selectedUncommitted: boolean;
    onSelectCommit: (commit: CommitSummary) => void;
    onSelectUncommitted: () => void;
    onNodeMouseEnter: (event: MouseEvent<SVGGElement>, commit: CommitSummary) => void;
    onNodeMouseLeave: () => void;
}

export function GraphSvg({
    snapshot,
    graphWidth,
    totalHeight,
    hasUncommitted,
    selectedCommitHash,
    selectedUncommitted,
    onSelectCommit,
    onSelectUncommitted,
    onNodeMouseEnter,
    onNodeMouseLeave
}: GraphSvgProps) {
    const uncommittedOffset = hasUncommitted ? GRAPH_ROW_HEIGHT : 0;
    const uncommittedHeadRow = hasUncommitted ? snapshot.rows.find((row) => row.commit.isHead) : undefined;
    const uncommittedLane = uncommittedHeadRow?.lane ?? 0;
    const uncommittedNodeX = 32 + uncommittedLane * GRAPH_LANE_GAP;
    const uncommittedNodeY = GRAPH_ROW_HEIGHT / 2;
    const uncommittedEdgeEndY = uncommittedOffset + (uncommittedHeadRow?.row ?? 0) * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
    const uncommittedEdgeMidY = uncommittedNodeY + (uncommittedEdgeEndY - uncommittedNodeY) / 2;

    const rowByHash = useMemo(() => {
        return new Map(snapshot.rows.map((row) => [row.commit.hash, row.row]));
    }, [snapshot.rows]);

    const worktreeHeadSet = useMemo(
        () => new Set(snapshot.worktreeHeads ?? []),
        [snapshot.worktreeHeads]
    );

    const edges = useMemo(() => snapshot.rows.flatMap((row) => {
        return row.connections.map((connection) => {
            const parentRow = rowByHash.get(connection.parentHash);
            if (parentRow === undefined) {
                return null;
            }

            const startX = 32 + row.lane * GRAPH_LANE_GAP;
            const endX = 32 + connection.lane * GRAPH_LANE_GAP;
            const startY = row.row * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
            const endY = parentRow * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
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
    }).filter(Boolean), [snapshot.rows, rowByHash]);

    const nodes = useMemo(() => snapshot.rows.map((row) => {
        const x = 32 + row.lane * GRAPH_LANE_GAP;
        const y = row.row * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
        const isSelected = row.commit.hash === selectedCommitHash;
        const isWorktreeHead = worktreeHeadSet.has(row.commit.hash);

        return (
            <g
                key={row.commit.hash}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectCommit(row.commit)}
                onMouseEnter={(event) => onNodeMouseEnter(event, row.commit)}
                onMouseLeave={onNodeMouseLeave}
            >
                <circle cx={x} cy={y} r={12} fill="transparent" />
                <circle cx={x} cy={y} r={isSelected ? 6 : 4.5} fill={getLaneColor(row.lane)} stroke="#f8fafc" strokeWidth={isSelected ? 2 : 1.5} />
                {row.commit.isHead ? <circle cx={x} cy={y} r={9} fill="none" stroke="#f8fafc" strokeOpacity={0.75} strokeWidth={1} /> : null}
                {isWorktreeHead ? (
                    <polygon
                        points={`${x},${y - 11} ${x + 7},${y - 4} ${x + 7},${y + 4} ${x},${y + 11} ${x - 7},${y + 4} ${x - 7},${y - 4}`}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth={1.25}
                        strokeOpacity={0.9}
                    />
                ) : null}
            </g>
        );
    }), [snapshot.rows, selectedCommitHash, worktreeHeadSet, onSelectCommit, onNodeMouseEnter, onNodeMouseLeave]);

    return (
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
    );
}
