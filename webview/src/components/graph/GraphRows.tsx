import type { MouseEvent } from 'react';
import type { CommitSummary, GraphSnapshot } from '../../../../src/core/models';
import { formatDate, highlightText } from './graphUtils';

interface GraphRowsProps {
    snapshot: GraphSnapshot;
    totalChanges: number;
    hasUncommitted: boolean;
    selectedCommitHash?: string;
    selectedUncommitted: boolean;
    searchPattern: RegExp | null;
    matchIndexByHash: Map<string, number>;
    currentMatchIndex: number;
    onSelectCommit: (commit: CommitSummary) => void;
    onSelectUncommitted: () => void;
    onOpenContextMenu: (commit: CommitSummary, point: { x: number; y: number }) => void;
}

export function GraphRows({
    snapshot,
    totalChanges,
    hasUncommitted,
    selectedCommitHash,
    selectedUncommitted,
    searchPattern,
    matchIndexByHash,
    currentMatchIndex,
    onSelectCommit,
    onSelectUncommitted,
    onOpenContextMenu
}: GraphRowsProps) {
    const handleContextMenu = (event: MouseEvent<HTMLButtonElement>, commit: CommitSummary): void => {
        event.preventDefault();
        onOpenContextMenu(commit, { x: event.clientX, y: event.clientY });
    };

    return (
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
    );
}
