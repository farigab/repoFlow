import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { CommitDetail, CommitFileChange, CommitSummary, DiffRequest, GraphFilters, GraphSnapshot } from '../../src/core/models/GitModels';
import type { ExtensionToWebviewMessage } from '../../src/shared/protocol';
import { CommitDetails } from './components/CommitDetails';
import { GraphCanvas } from './components/GraphCanvas';
import { vscode } from './vscode';

interface ContextMenuState {
    commit: CommitSummary;
    x: number;
    y: number;
}

const DEFAULT_FILTERS: GraphFilters = {
    includeRemotes: true,
    limit: 200
};

function areFiltersEqual(left: GraphFilters, right: GraphFilters): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function App() {
    const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
    const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
    const [selectedCommitHash, setSelectedCommitHash] = useState<string>();
    const [selectedCommit, setSelectedCommit] = useState<CommitDetail | null>(null);
    const [busy, setBusy] = useState<{ value: boolean; label?: string }>({ value: false });
    const [notification, setNotification] = useState<{ kind: 'info' | 'error'; message: string } | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const deferredFilters = {
        ...filters,
        search: useDeferredValue(filters.search),
        author: useDeferredValue(filters.author)
    } satisfies GraphFilters;

    useEffect(() => {
        const handler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
            const message = event.data;

            switch (message.type) {
                case 'graphSnapshot':
                    setSnapshot(message.payload);
                    setFilters(message.payload.filters);
                    return;
                case 'commitDetail':
                    setSelectedCommit(message.payload);
                    setSelectedCommitHash(message.payload.hash);
                    return;
                case 'busy':
                    setBusy(message.payload);
                    return;
                case 'notification':
                    setNotification(message.payload);
                    window.setTimeout(() => setNotification(null), 3000);
                    return;
                default:
                    return;
            }
        };

        window.addEventListener('message', handler);
        vscode.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        if (!selectedCommitHash || !snapshot.rows.some((row) => row.commit.hash === selectedCommitHash)) {
            const firstCommit = snapshot.rows[0]?.commit;
            if (firstCommit) {
                setSelectedCommitHash(firstCommit.hash);
                vscode.postMessage({
                    type: 'selectCommit',
                    payload: { repoRoot: snapshot.repoRoot, commitHash: firstCommit.hash }
                });
            }
        }
    }, [snapshot, selectedCommitHash]);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            if (!areFiltersEqual(snapshot.filters, deferredFilters)) {
                startTransition(() => {
                    vscode.postMessage({ type: 'applyFilters', payload: deferredFilters });
                });
            }
        }, 180);

        return () => window.clearTimeout(timeoutId);
    }, [deferredFilters, snapshot]);

    useEffect(() => {
        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

    const assets = useMemo(() => window.__GITGRAPHOR_ASSETS__ ?? {}, []);

    const handleSelectCommit = (commit: CommitSummary): void => {
        if (!snapshot) {
            return;
        }

        setSelectedCommitHash(commit.hash);
        vscode.postMessage({
            type: 'selectCommit',
            payload: { repoRoot: snapshot.repoRoot, commitHash: commit.hash }
        });
    };

    const handleOpenDiff = (file: CommitFileChange, detail: CommitDetail): void => {
        if (!snapshot) {
            return;
        }

        const request: DiffRequest = {
            repoRoot: snapshot.repoRoot,
            commitHash: detail.hash,
            parentHash: detail.parentHashes[0],
            filePath: file.path,
            originalPath: file.originalPath
        };

        vscode.postMessage({ type: 'openDiff', payload: request });
    };

    const handleContextAction = (action: 'checkout' | 'cherryPick' | 'createBranch' | 'copyHash' | 'openTerminal'): void => {
        if (!snapshot || !contextMenu) {
            return;
        }

        switch (action) {
            case 'checkout':
                vscode.postMessage({ type: 'checkoutCommit', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'cherryPick':
                vscode.postMessage({ type: 'cherryPick', payload: { repoRoot: snapshot.repoRoot, commitHash: contextMenu.commit.hash } });
                break;
            case 'createBranch':
                vscode.postMessage({ type: 'createBranchPrompt', payload: { repoRoot: snapshot.repoRoot, fromRef: contextMenu.commit.hash } });
                break;
            case 'copyHash':
                vscode.postMessage({ type: 'copyHash', payload: { hash: contextMenu.commit.hash } });
                break;
            case 'openTerminal':
                vscode.postMessage({
                    type: 'openInTerminal',
                    payload: { repoRoot: snapshot.repoRoot, command: `git show --stat ${contextMenu.commit.hash}` }
                });
                break;
            default:
                break;
        }

        setContextMenu(null);
    };

    if (!snapshot) {
        return (
            <main className="shell shell--loading">
                <div className="loading-card panel">
                    {assets.hero ? <img className="loading-card__hero" src={assets.hero} alt="Git Graphor" /> : null}
                    <h1>Git Graphor</h1>
                    <p>Loading repository graph...</p>
                </div>
            </main>
        );
    }

    return (
        <main className="shell">
            <section className="layout">
                <GraphCanvas
                    snapshot={snapshot}
                    selectedCommitHash={selectedCommitHash}
                    onSelectCommit={handleSelectCommit}
                    onOpenContextMenu={(commit, point) => setContextMenu({ commit, ...point })}
                    onLoadMore={(limit) => vscode.postMessage({ type: 'loadMore', payload: { limit } })}
                />

                <aside className="sidebar">
                    <CommitDetails detail={selectedCommit} repoRoot={snapshot.repoRoot} onOpenDiff={handleOpenDiff} />
                </aside>
            </section>

            {contextMenu ? (
                <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
                    <button type="button" onClick={() => handleContextAction('checkout')}>
                        Checkout Commit
                    </button>
                    <button type="button" onClick={() => handleContextAction('cherryPick')}>
                        Cherry-pick
                    </button>
                    <button type="button" onClick={() => handleContextAction('createBranch')}>
                        Create Branch From Commit
                    </button>
                    <button type="button" onClick={() => handleContextAction('copyHash')}>
                        Copy Hash
                    </button>
                    <button type="button" onClick={() => handleContextAction('openTerminal')}>
                        Open In Terminal
                    </button>
                </div>
            ) : null}

            {busy.value ? <div className="busy-indicator">{busy.label ?? 'Processing...'}</div> : null}
            {notification ? <div className={`toast toast--${notification.kind}`}>{notification.message}</div> : null}
        </main>
    );
}
