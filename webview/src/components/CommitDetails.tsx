import type { CommitDetail, CommitFileChange } from '../../../src/core/models/GitModels';

interface CommitDetailsProps {
    detail: CommitDetail | null;
    repoRoot?: string;
    onOpenDiff: (file: CommitFileChange, detail: CommitDetail) => void;
}

function formatFullDate(input: string): string {
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(input));
}

export function CommitDetails({ detail, onOpenDiff }: CommitDetailsProps) {
    if (!detail) {
        return (
            <section className="details panel">
                <header className="panel__header">
                    <div>
                        <span className="panel__eyebrow">Commit Details</span>
                        <h2>Select a commit</h2>
                    </div>
                </header>
                <div className="empty-state">Choose a commit in the graph to inspect files, stats and native diffs.</div>
            </section>
        );
    }

    return (
        <section className="details panel">
            <header className="panel__header panel__header--stacked">
                <div>
                    <span className="panel__eyebrow">Commit Details</span>
                    <h2>{detail.subject}</h2>
                </div>
                <div className="details__meta-grid">
                    <div>
                        <span>Hash</span>
                        <strong>{detail.hash}</strong>
                    </div>
                    <div>
                        <span>Author</span>
                        <strong>{detail.authorName}</strong>
                    </div>
                    <div>
                        <span>Date</span>
                        <strong>{formatFullDate(detail.authoredAt)}</strong>
                    </div>
                    <div>
                        <span>Stats</span>
                        <strong>
                            +{detail.stats.additions} / -{detail.stats.deletions} / {detail.stats.filesChanged} files
                        </strong>
                    </div>
                </div>
            </header>

            {detail.body ? <pre className="details__body">{detail.body}</pre> : null}

            <div className="details__files">
                {detail.files.map((file) => (
                    <button key={`${detail.hash}-${file.path}`} type="button" className="file-card" onClick={() => onOpenDiff(file, detail)}>
                        <div className="file-card__path">
                            <span className={`status-badge status-badge--${file.status.toLowerCase()}`}>{file.status}</span>
                            <strong>{file.path}</strong>
                        </div>
                        {file.originalPath ? <div className="file-card__rename">from {file.originalPath}</div> : null}
                        <div className="file-card__stats">
                            <span className="file-card__stats--add">+{file.additions}</span>
                            <span className="file-card__stats--del">-{file.deletions}</span>
                        </div>
                    </button>
                ))}
            </div>
        </section>
    );
}
