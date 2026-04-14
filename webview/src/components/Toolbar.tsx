import type { BranchSummary, GraphFilters, GraphSnapshot } from '../../../src/core/models/GitModels';

interface ToolbarProps {
    snapshot: GraphSnapshot;
    filters: GraphFilters;
    onChangeFilters: (filters: GraphFilters) => void;
    onRefresh: () => void;
    onFetch: () => void;
    onPull: () => void;
    onPush: () => void;
    onCreateBranch: () => void;
    onCommit: () => void;
    onCheckoutBranch: (branchName: string) => void;
    onDeleteBranch: (branchName: string) => void;
    onMergeBranch: (branchName: string) => void;
}

function branchSort(left: BranchSummary, right: BranchSummary): number {
    if (left.current && !right.current) {
        return -1;
    }

    if (!left.current && right.current) {
        return 1;
    }

    return left.shortName.localeCompare(right.shortName);
}

export function Toolbar({
    snapshot,
    filters,
    onChangeFilters,
    onRefresh,
    onFetch,
    onPull,
    onPush,
    onCreateBranch,
    onCommit,
    onCheckoutBranch,
    onDeleteBranch,
    onMergeBranch
}: ToolbarProps) {
    const localBranches = snapshot.branches.filter((branch) => !branch.remote).sort(branchSort);
    const activeBranch = snapshot.localChanges.currentBranch;
    const selectedBranch = filters.branch ?? '';

    return (
        <section className="toolbar panel">
            <div className="toolbar__identity">
                <div className="toolbar__eyebrow">Git Graphor</div>
                <h1 className="toolbar__title">Repository Graph</h1>
                <p className="toolbar__subtitle">Visualize branches, merges, tags and working tree changes in one place.</p>
            </div>

            <div className="toolbar__filters">
                <label className="field">
                    <span>Search</span>
                    <input
                        value={filters.search ?? ''}
                        onChange={(event) => onChangeFilters({ ...filters, search: event.target.value || undefined })}
                        placeholder="Message, hash or author"
                    />
                </label>

                <label className="field">
                    <span>Author</span>
                    <input
                        value={filters.author ?? ''}
                        onChange={(event) => onChangeFilters({ ...filters, author: event.target.value || undefined })}
                        placeholder="Filter by author"
                    />
                </label>

                <label className="field field--compact">
                    <span>Branch</span>
                    <select
                        value={selectedBranch}
                        onChange={(event) => onChangeFilters({ ...filters, branch: event.target.value || undefined })}
                    >
                        <option value="">All branches</option>
                        {localBranches.map((branch) => (
                            <option key={branch.name} value={branch.shortName}>
                                {branch.current ? 'HEAD · ' : ''}
                                {branch.shortName}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="field field--date">
                    <span>Since</span>
                    <input
                        type="date"
                        value={filters.since ?? ''}
                        onChange={(event) => onChangeFilters({ ...filters, since: event.target.value || undefined })}
                    />
                </label>

                <label className="field field--date">
                    <span>Until</span>
                    <input
                        type="date"
                        value={filters.until ?? ''}
                        onChange={(event) => onChangeFilters({ ...filters, until: event.target.value || undefined })}
                    />
                </label>

                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={filters.includeRemotes}
                        onChange={(event) => onChangeFilters({ ...filters, includeRemotes: event.target.checked })}
                    />
                    <span>Remote branches</span>
                </label>
            </div>

            <div className="toolbar__status">
                <div className="status-chip status-chip--accent">
                    <span className="status-chip__label">Repo</span>
                    <strong>{snapshot.repoRoot.split(/[/\\]/).pop()}</strong>
                </div>
                <div className="status-chip">
                    <span className="status-chip__label">HEAD</span>
                    <strong>{activeBranch ?? 'detached'}</strong>
                </div>
                <div className="status-chip">
                    <span className="status-chip__label">Sync</span>
                    <strong>
                        ↑{snapshot.localChanges.ahead} ↓{snapshot.localChanges.behind}
                    </strong>
                </div>
                <div className="status-chip">
                    <span className="status-chip__label">Graph</span>
                    <strong>{snapshot.rows.length} commits</strong>
                </div>
            </div>

            <div className="toolbar__actions">
                <button type="button" onClick={onRefresh}>
                    Refresh
                </button>
                <button type="button" onClick={onFetch}>
                    Fetch
                </button>
                <button type="button" onClick={onPull}>
                    Pull
                </button>
                <button type="button" onClick={onPush}>
                    Push
                </button>
                <button type="button" onClick={onCreateBranch}>
                    Create Branch
                </button>
                <button type="button" onClick={onCommit}>
                    Commit
                </button>

                <label className="field field--compact field--inline">
                    <span>Branch actions</span>
                    <select
                        value={selectedBranch}
                        onChange={(event) => onChangeFilters({ ...filters, branch: event.target.value || undefined })}
                    >
                        <option value="">Select branch</option>
                        {localBranches.map((branch) => (
                            <option key={`actions-${branch.name}`} value={branch.shortName}>
                                {branch.shortName}
                            </option>
                        ))}
                    </select>
                </label>

                <button type="button" disabled={!selectedBranch} onClick={() => selectedBranch && onCheckoutBranch(selectedBranch)}>
                    Checkout
                </button>
                <button type="button" disabled={!selectedBranch || selectedBranch === activeBranch} onClick={() => selectedBranch && onMergeBranch(selectedBranch)}>
                    Merge
                </button>
                <button type="button" disabled={!selectedBranch || selectedBranch === activeBranch} onClick={() => selectedBranch && onDeleteBranch(selectedBranch)}>
                    Delete
                </button>
            </div>
        </section>
    );
}
