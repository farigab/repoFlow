import type { CSSProperties, MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommitSummary, GraphSnapshot } from '../../../src/core/models';
import { CommitHoverTooltip, type HoverTooltip } from './graph/CommitHoverTooltip';
import { FindBar } from './graph/FindBar';
import { GraphRows } from './graph/GraphRows';
import { GraphSvg } from './graph/GraphSvg';
import { GraphToolbar } from './graph/GraphToolbar';
import { buildSearchPattern, formatDate, GRAPH_LANE_GAP, GRAPH_ROW_HEIGHT } from './graph/graphUtils';
import { RepoStatusBanner, type RepoBannerAction } from './graph/RepoStatusBanner';

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
    onOpenBranchCompareModal: () => void;
    onOpenUndoModal: () => void;
    onBannerAction: (action: RepoBannerAction) => void;
    onOpenConflictFile: (filePath: string) => void;
}

export function GraphCanvas({
    snapshot,
    selectedCommitHash,
    selectedUncommitted,
    onSelectCommit,
    onSelectUncommitted,
    onOpenContextMenu,
    onLoadMore,
    onOpenSettings,
    onOpenPR,
    onOpenDeleteBranches,
    onOpenStashModal,
    onOpenWorktreeModal,
    onOpenBranchCompareModal,
    onOpenUndoModal,
    onBannerAction,
    onOpenConflictFile
}: GraphCanvasProps) {
    const graphWidth = Math.max(110, 52 + (snapshot.maxLane + 1) * GRAPH_LANE_GAP);
    const totalChanges = snapshot.localChanges.staged.length + snapshot.localChanges.unstaged.length + snapshot.localChanges.conflicted.length;
    const hasUncommitted = totalChanges > 0;
    const totalHeight = snapshot.rows.length * GRAPH_ROW_HEIGHT + (hasUncommitted ? GRAPH_ROW_HEIGHT : 0);

    const viewportRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [hoverTooltip, setHoverTooltip] = useState<HoverTooltip | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

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
        viewport.addEventListener('scroll', handleScroll, { passive: true });
        return () => viewport.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

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
                ...row.commit.refs.map((ref) => ref.name)
            ];
            return fields.some((field) => {
                searchPattern.lastIndex = 0;
                return searchPattern.test(field);
            });
        });
    }, [searchPattern, snapshot.rows]);

    const matchIndexByHash = useMemo(() => {
        const map = new Map<string, number>();
        matchedRows.forEach((row, index) => map.set(row.commit.hash, index));
        return map;
    }, [matchedRows]);

    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
                event.preventDefault();
                setSearchOpen(true);
                window.setTimeout(() => {
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                }, 0);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        setCurrentMatchIndex(0);
    }, [searchQuery, caseSensitive, wholeWord, useRegex]);

    useEffect(() => {
        if (matchedRows.length === 0 || !viewportRef.current) return;
        const match = matchedRows[currentMatchIndex % matchedRows.length];
        if (!match) return;
        const el = viewportRef.current.querySelector(`[data-hash="${match.commit.hash}"]`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentMatchIndex, matchedRows]);

    const handleNodeMouseEnter = useCallback((event: MouseEvent<SVGGElement>, commit: CommitSummary) => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        setHoverTooltip({ commit, x: event.clientX + 14, y: event.clientY + 18 });
    }, []);

    const handleNodeMouseLeave = useCallback(() => {
        hoverTimerRef.current = setTimeout(() => setHoverTooltip(null), 100);
    }, []);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        setSearchQuery('');
    }, []);

    const nextMatch = useCallback(() => {
        if (matchedRows.length === 0) return;
        setCurrentMatchIndex((index) => (index + 1) % matchedRows.length);
    }, [matchedRows.length]);

    const prevMatch = useCallback(() => {
        if (matchedRows.length === 0) return;
        setCurrentMatchIndex((index) => (index - 1 + matchedRows.length) % matchedRows.length);
    }, [matchedRows.length]);

    return (
        <section className="graph panel">
            <header className="panel__header">
                <div>
                    <span className="panel__eyebrow">Commit Graph</span>
                    <h2>History</h2>
                </div>
                <GraphToolbar
                    onOpenPR={onOpenPR}
                    onOpenWorktreeModal={onOpenWorktreeModal}
                    onOpenStashModal={onOpenStashModal}
                    onOpenBranchCompareModal={onOpenBranchCompareModal}
                    onOpenUndoModal={onOpenUndoModal}
                    onOpenDeleteBranches={onOpenDeleteBranches}
                    onOpenSettings={onOpenSettings}
                />
            </header>

            <RepoStatusBanner status={snapshot.localChanges} onAction={onBannerAction} onOpenConflictFile={onOpenConflictFile} />

            <div className="graph__body">
                {searchOpen && (
                    <FindBar
                        inputRef={searchInputRef}
                        searchQuery={searchQuery}
                        caseSensitive={caseSensitive}
                        wholeWord={wholeWord}
                        useRegex={useRegex}
                        currentMatchIndex={currentMatchIndex}
                        matchCount={matchedRows.length}
                        onSearchQueryChange={setSearchQuery}
                        onCaseSensitiveChange={setCaseSensitive}
                        onWholeWordChange={setWholeWord}
                        onUseRegexChange={setUseRegex}
                        onNextMatch={nextMatch}
                        onPreviousMatch={prevMatch}
                        onClose={closeSearch}
                    />
                )}

                <div className="graph__viewport" ref={viewportRef}>
                    <div className="graph__canvas" style={{ '--graph-width': `${graphWidth}px` } as CSSProperties}>
                        <GraphSvg
                            snapshot={snapshot}
                            graphWidth={graphWidth}
                            totalHeight={totalHeight}
                            hasUncommitted={hasUncommitted}
                            selectedCommitHash={selectedCommitHash}
                            selectedUncommitted={selectedUncommitted}
                            onSelectCommit={onSelectCommit}
                            onSelectUncommitted={onSelectUncommitted}
                            onNodeMouseEnter={handleNodeMouseEnter}
                            onNodeMouseLeave={handleNodeMouseLeave}
                        />
                        <GraphRows
                            snapshot={snapshot}
                            totalChanges={totalChanges}
                            hasUncommitted={hasUncommitted}
                            selectedCommitHash={selectedCommitHash}
                            selectedUncommitted={selectedUncommitted}
                            searchPattern={searchPattern}
                            matchIndexByHash={matchIndexByHash}
                            currentMatchIndex={currentMatchIndex}
                            onSelectCommit={onSelectCommit}
                            onSelectUncommitted={onSelectUncommitted}
                            onOpenContextMenu={onOpenContextMenu}
                        />
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
