import type { WorkingTreeFile, WorkingTreeStatus } from '../../../src/core/models/GitModels';

interface LocalChangesPanelProps {
    status: WorkingTreeStatus;
    onStage: (file: WorkingTreeFile) => void;
    onUnstage: (file: WorkingTreeFile) => void;
    onDiscard: (file: WorkingTreeFile) => void;
    onCommit: () => void;
}

interface FileSectionProps {
    title: string;
    files: WorkingTreeFile[];
    onPrimaryAction: (file: WorkingTreeFile) => void;
    primaryLabel: string;
    onDiscard: (file: WorkingTreeFile) => void;
}

function FileSection({ title, files, onPrimaryAction, primaryLabel, onDiscard }: FileSectionProps) {
    if (files.length === 0) {
        return null;
    }

    return (
        <section className="changes__section">
            <header className="changes__section-header">
                <h3>{title}</h3>
                <span>{files.length}</span>
            </header>
            <div className="changes__list">
                {files.map((file) => (
                    <div key={`${title}-${file.path}-${file.indexStatus}${file.workTreeStatus}`} className="change-item">
                        <div className="change-item__path">
                            <strong>{file.path}</strong>
                            <span>
                                {file.indexStatus}/{file.workTreeStatus}
                            </span>
                        </div>
                        <div className="change-item__actions">
                            <button type="button" onClick={() => onPrimaryAction(file)}>
                                {primaryLabel}
                            </button>
                            <button type="button" className="button--ghost" onClick={() => onDiscard(file)}>
                                Discard
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

export function LocalChangesPanel({ status, onStage, onUnstage, onDiscard, onCommit }: LocalChangesPanelProps) {
    const totalChanges = status.staged.length + status.unstaged.length + status.conflicted.length;

    return (
        <section className="changes panel">
            <header className="panel__header">
                <div>
                    <span className="panel__eyebrow">Working Tree</span>
                    <h2>Local Changes</h2>
                </div>
                <button type="button" onClick={onCommit} disabled={status.staged.length === 0}>
                    Commit Staged
                </button>
            </header>

            <div className="changes__summary">
                <div>
                    <span>Total</span>
                    <strong>{totalChanges}</strong>
                </div>
                <div>
                    <span>Ahead / Behind</span>
                    <strong>
                        {status.ahead} / {status.behind}
                    </strong>
                </div>
                <div>
                    <span>Branch</span>
                    <strong>{status.currentBranch ?? 'detached'}</strong>
                </div>
            </div>

            <FileSection title="Conflicts" files={status.conflicted} onPrimaryAction={onStage} primaryLabel="Stage" onDiscard={onDiscard} />
            <FileSection title="Staged" files={status.staged} onPrimaryAction={onUnstage} primaryLabel="Unstage" onDiscard={onDiscard} />
            <FileSection title="Unstaged" files={status.unstaged} onPrimaryAction={onStage} primaryLabel="Stage" onDiscard={onDiscard} />
        </section>
    );
}
