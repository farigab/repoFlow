import { useState } from 'react';
import type { BranchSummary, GraphFilters, GraphSnapshot } from '../../../src/core/models';
import { vscode } from '../vscode';

const COMMON_HOOKS = ['pre-commit', 'commit-msg', 'pre-push'] as const;
const VALID_HOOK_NAME = /^[a-z0-9][a-z0-9-]*$/i;

interface RepoSettingsModalProps {
    snapshot: GraphSnapshot;
    filters: GraphFilters;
    onChangeFilters: (filters: GraphFilters) => void;
    onClose: () => void;
}

function groupRemotes(branches: BranchSummary[]): Map<string, BranchSummary[]> {
    const map = new Map<string, BranchSummary[]>();
    for (const branch of branches) {
        if (!branch.remote) {
            continue;
        }
        const remote = branch.shortName.split('/')[0] ?? 'origin';
        if (!map.has(remote)) {
            map.set(remote, []);
        }
        map.get(remote)!.push(branch);
    }
    return map;
}

export function RepoSettingsModal({ snapshot, filters, onChangeFilters, onClose }: RepoSettingsModalProps) {
    const repoName = snapshot.repoRoot.split(/[/\\]/).pop() ?? snapshot.repoRoot;
    const remoteGroups = groupRemotes(snapshot.branches);
    const localBranches = snapshot.branches.filter((b) => !b.remote);

    const [userName, setUserName] = useState(snapshot.repoConfig.userName);
    const [userEmail, setUserEmail] = useState(snapshot.repoConfig.userEmail);
    const [hooksPath, setHooksPath] = useState(snapshot.repoConfig.hooksPath);
    const [customHookName, setCustomHookName] = useState('');
    const [remoteUrls, setRemoteUrls] = useState<Record<string, string>>(
        Object.fromEntries(snapshot.repoConfig.remotes.map((r) => [r.name, r.url]))
    );
    const normalizedHooksPath = hooksPath.trim();
    const displayedHooksPath = normalizedHooksPath || '.git/hooks (default)';
    const existingHooks = snapshot.repoConfig.hookScripts;
    const existingHookSet = new Set(existingHooks);
    const customHooks = existingHooks.filter((hookName) => !COMMON_HOOKS.includes(hookName as typeof COMMON_HOOKS[number]));
    const trimmedCustomHookName = customHookName.trim();
    const customHookNameIsValid = VALID_HOOK_NAME.test(trimmedCustomHookName);

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const saveUserName = () => {
        const trimmed = userName.trim();
        if (trimmed && trimmed !== snapshot.repoConfig.userName) {
            vscode.postMessage({ type: 'setGitUserName', payload: { repoRoot: snapshot.repoRoot, name: trimmed } });
        }
    };

    const saveUserEmail = () => {
        const trimmed = userEmail.trim();
        if (trimmed && trimmed !== snapshot.repoConfig.userEmail) {
            vscode.postMessage({ type: 'setGitUserEmail', payload: { repoRoot: snapshot.repoRoot, email: trimmed } });
        }
    };

    const saveHooksPath = () => {
        const trimmed = normalizedHooksPath;
        const original = snapshot.repoConfig.hooksPath.trim();
        if (trimmed !== original) {
            vscode.postMessage({ type: 'setGitHooksPath', payload: { repoRoot: snapshot.repoRoot, hooksPath: trimmed } });
        }
    };

    const postHooksAction = (message: { type: 'openHooksFolder'; payload: { repoRoot: string; hooksPath: string } } | { type: 'openHookScript'; payload: { repoRoot: string; hooksPath: string; hookName: string } }) => {
        const original = snapshot.repoConfig.hooksPath.trim();
        if (normalizedHooksPath !== original) {
            vscode.postMessage({ type: 'setGitHooksPath', payload: { repoRoot: snapshot.repoRoot, hooksPath: normalizedHooksPath } });
        }
        vscode.postMessage(message);
    };

    const openHookScript = (hookName: string) => {
        postHooksAction({ type: 'openHookScript', payload: { repoRoot: snapshot.repoRoot, hooksPath: normalizedHooksPath, hookName } });
    };

    const submitCustomHook = () => {
        if (!customHookNameIsValid) {
            return;
        }

        openHookScript(trimmedCustomHookName);
        setCustomHookName('');
    };

    const saveRemoteUrl = (remoteName: string) => {
        const url = (remoteUrls[remoteName] ?? '').trim();
        const original = snapshot.repoConfig.remotes.find((r) => r.name === remoteName)?.url ?? '';
        if (url && url !== original) {
            vscode.postMessage({ type: 'setRemoteUrl', payload: { repoRoot: snapshot.repoRoot, remoteName, url } });
        }
    };

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="Repository Settings">
                <header className="modal__header modal__header--hero">
                    <div className="modal__title-group">
                        <span className="modal__eyebrow">{repoName}</span>
                        <h2>Repository Settings</h2>
                    </div>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>

                <div className="modal__body">

                    {/* ── General ──────────────────────────────── */}
                    <section className="settings-section">
                        <h3 className="settings-section__title">General</h3>
                        <div className="settings-row settings-row--readonly">
                            <span className="settings-row__label">Name</span>
                            <span className="settings-row__value">{repoName}</span>
                        </div>
                        <div className="settings-row settings-row--readonly">
                            <span className="settings-row__label">Path</span>
                            <span className="settings-row__value settings-row__value--muted">{snapshot.repoRoot}</span>
                        </div>
                        <div className="settings-row">
                            <label className="settings-toggle">
                                <input
                                    type="checkbox"
                                    checked={filters.includeRemotes}
                                    onChange={(e) => onChangeFilters({ ...filters, includeRemotes: e.target.checked })}
                                />
                                <span>Show remote branches</span>
                            </label>
                        </div>
                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="settings-limit">Commit limit</label>
                            <input
                                id="settings-limit"
                                type="number"
                                min={50}
                                max={5000}
                                step={50}
                                className="settings-input"
                                value={filters.limit}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val >= 50) {
                                        onChangeFilters({ ...filters, limit: val });
                                    }
                                }}
                            />
                        </div>
                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="settings-hookspath">Hooks path</label>
                            <div className="settings-editable">
                                <input
                                    id="settings-hookspath"
                                    type="text"
                                    className="settings-input settings-input--wide"
                                    value={hooksPath}
                                    onChange={(e) => setHooksPath(e.target.value)}
                                    onBlur={saveHooksPath}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { saveHooksPath(); (e.target as HTMLInputElement).blur(); } }}
                                    placeholder=".githooks"
                                />
                            </div>
                        </div>
                    </section>

                    <section className="settings-section">
                        <h3 className="settings-section__title">Git Hooks</h3>
                        <div className="settings-row settings-row--readonly">
                            <span className="settings-row__label">Active path</span>
                            <span className="settings-row__value settings-row__value--muted">{displayedHooksPath}</span>
                        </div>
                        <div className="settings-row settings-row--top">
                            <span className="settings-row__label">Directory</span>
                            <div className="settings-editable settings-editable--stack">
                                <div className="settings-actions">
                                    <button
                                        type="button"
                                        onClick={() => postHooksAction({ type: 'openHooksFolder', payload: { repoRoot: snapshot.repoRoot, hooksPath: normalizedHooksPath } })}
                                    >
                                        <i className="codicon codicon-folder-opened" aria-hidden="true" />
                                        Open hooks folder
                                    </button>
                                </div>
                                <p className="settings-help">Opens the configured hooks directory. If it does not exist yet, RepoFlow creates it first.</p>
                            </div>
                        </div>
                        <div className="settings-row settings-row--top">
                            <span className="settings-row__label">Common hooks</span>
                            <div className="settings-editable settings-editable--stack">
                                <div className="settings-hook-list">
                                    {COMMON_HOOKS.map((hookName) => (
                                        <button
                                            key={hookName}
                                            type="button"
                                            className="settings-hook-item"
                                            onClick={() => openHookScript(hookName)}
                                        >
                                            <span className={`settings-hook-item__status ${existingHookSet.has(hookName) ? 'settings-hook-item__status--exists' : 'settings-hook-item__status--missing'}`}>
                                                <i className={`codicon ${existingHookSet.has(hookName) ? 'codicon-check' : 'codicon-close'}`} aria-hidden="true" />
                                            </span>
                                            <span className="settings-hook-item__name">{hookName}</span>
                                            <span className="settings-hook-item__state">{existingHookSet.has(hookName) ? 'Exists' : 'Not created'}</span>
                                        </button>
                                    ))}
                                </div>
                                <p className="settings-help">Each hook shows whether the script already exists. Clicking opens it, or creates a starter script first.</p>
                            </div>
                        </div>
                        <div className="settings-row settings-row--top">
                            <span className="settings-row__label">Custom hooks</span>
                            <div className="settings-editable settings-editable--stack">
                                <div className="settings-custom-hook">
                                    <input
                                        type="text"
                                        className="settings-input settings-input--wide"
                                        value={customHookName}
                                        onChange={(e) => setCustomHookName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { submitCustomHook(); } }}
                                        placeholder="post-merge"
                                        aria-label="Custom hook name"
                                    />
                                    <button type="button" onClick={submitCustomHook} disabled={!customHookNameIsValid}>
                                        <i className="codicon codicon-add" aria-hidden="true" />
                                        Open or create
                                    </button>
                                </div>
                                <p className="settings-help">Use any valid Git hook name, for example `pre-rebase`, `post-merge` or `prepare-commit-msg`.</p>
                                {customHooks.length > 0 ? (
                                    <div className="settings-actions settings-actions--wrap">
                                        {customHooks.map((hookName) => (
                                            <button key={hookName} type="button" onClick={() => openHookScript(hookName)}>
                                                <i className="codicon codicon-edit" aria-hidden="true" />
                                                {hookName}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="settings-help">No custom hooks created yet.</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* ── User Details ─────────────────────────── */}
                    <section className="settings-section">
                        <h3 className="settings-section__title">User Details</h3>
                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="settings-username">User Name</label>
                            <div className="settings-editable">
                                <input
                                    id="settings-username"
                                    type="text"
                                    className="settings-input settings-input--wide"
                                    value={userName}
                                    onChange={(e) => setUserName(e.target.value)}
                                    onBlur={saveUserName}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { saveUserName(); (e.target as HTMLInputElement).blur(); } }}
                                    placeholder="Your name"
                                />
                            </div>
                        </div>
                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="settings-useremail">User Email</label>
                            <div className="settings-editable">
                                <input
                                    id="settings-useremail"
                                    type="email"
                                    className="settings-input settings-input--wide"
                                    value={userEmail}
                                    onChange={(e) => setUserEmail(e.target.value)}
                                    onBlur={saveUserEmail}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { saveUserEmail(); (e.target as HTMLInputElement).blur(); } }}
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>
                    </section>

                    {/* ── Remote Configuration ─────────────────── */}
                    {snapshot.repoConfig.remotes.length > 0 && (
                        <section className="settings-section">
                            <h3 className="settings-section__title">Remote Configuration</h3>
                            {snapshot.repoConfig.remotes.map((remote) => (
                                <div key={remote.name} className="settings-row">
                                    <label className="settings-row__label" htmlFor={`settings-remote-${remote.name}`}>
                                        <i className="codicon codicon-remote" aria-hidden="true" style={{ marginRight: '0.3rem' }} />
                                        {remote.name}
                                    </label>
                                    <div className="settings-editable">
                                        <input
                                            id={`settings-remote-${remote.name}`}
                                            type="text"
                                            className="settings-input settings-input--wide"
                                            value={remoteUrls[remote.name] ?? remote.url}
                                            onChange={(e) => setRemoteUrls((prev) => ({ ...prev, [remote.name]: e.target.value }))}
                                            onBlur={() => saveRemoteUrl(remote.name)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { saveRemoteUrl(remote.name); (e.target as HTMLInputElement).blur(); } }}
                                            placeholder="https://github.com/..."
                                        />
                                    </div>
                                </div>
                            ))}
                            <div className="settings-table">
                                <div className="settings-table__head">
                                    <span>Remote</span>
                                    <span>Branches</span>
                                </div>
                                {[...remoteGroups.entries()].map(([remote, branches]) => (
                                    <div key={remote} className="settings-table__row">
                                        <span className="settings-table__remote">
                                            <i className="codicon codicon-remote" aria-hidden="true" />
                                            {remote}
                                        </span>
                                        <span className="settings-table__branches">
                                            {branches.map((b) => b.shortName.split('/').slice(1).join('/')).join(', ')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* ── Local Branches ───────────────────────── */}
                    {localBranches.length > 0 && (
                        <section className="settings-section">
                            <h3 className="settings-section__title">Local Branches</h3>
                            <div className="settings-branches">
                                {localBranches.map((b) => (
                                    <div key={b.name} className="settings-branch-row">
                                        <i className={`codicon codicon-git-branch${b.current ? ' settings-branch-row__icon--active' : ''}`} aria-hidden="true" />
                                        <span className={b.current ? 'settings-branch-row--current' : ''}>
                                            {b.shortName}
                                        </span>
                                        {b.upstream && (
                                            <span className="settings-branch-row__upstream">{b.upstream}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                </div>
            </div>
        </div>
    );
}
