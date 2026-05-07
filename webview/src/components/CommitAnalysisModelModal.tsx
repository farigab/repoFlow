import { useMemo, useState } from 'react';
import type { CommitAnalysisModelOption } from '../../../src/core/models';

interface CommitAnalysisModelModalProps {
    currentSelection: string;
    options: CommitAnalysisModelOption[];
    onSelect: (selection: string) => void;
    onClose: () => void;
}

function matchesQuery(option: CommitAnalysisModelOption, query: string): boolean {
    if (!query) {
        return true;
    }

    const haystack = [
        option.label,
        option.provider,
        option.family,
        option.version,
        option.description,
        option.costPriority
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return haystack.includes(query.toLowerCase());
}

export function CommitAnalysisModelModal({ currentSelection, options, onSelect, onClose }: Readonly<CommitAnalysisModelModalProps>) {
    const [query, setQuery] = useState('');

    const filteredOptions = useMemo(
        () => options.filter((option) => matchesQuery(option, query)),
        [options, query]
    );

    const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
            onClose();
        }
    };

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Choose commit analysis model">
                <header className="modal__header modal__header--hero">
                    <div className="modal__title-group">
                        <span className="modal__eyebrow">AI Analysis</span>
                        <h2>Choose Model</h2>
                    </div>
                    <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </header>
                <div className="modal__body">
                    <section className="settings-section">
                        <input
                            type="text"
                            className="settings-input settings-input--wide"
                            placeholder="Search models"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            aria-label="Search models"
                        />
                    </section>

                    <section className="settings-section">
                        <h3 className="settings-section__title">Available Models</h3>
                        <div className="model-picker-list">
                            <button
                                type="button"
                                className={`model-picker-card${currentSelection === 'auto' ? ' model-picker-card--selected' : ''}`}
                                onClick={() => onSelect('auto')}
                            >
                                <div className="model-picker-card__header">
                                    <div>
                                        <strong>Auto</strong>
                                        <span className="model-picker-card__provider">RepoFlow automatic selection</span>
                                    </div>
                                    {currentSelection === 'auto' ? <span className="model-picker-card__current">Current</span> : null}
                                </div>
                                <div className="model-picker-card__meta">
                                    <span>Provider: GitHub Copilot</span>
                                    <span>Family: Best available</span>
                                    <span>Version: dynamic</span>
                                    <span>Cost / priority: automatic</span>
                                </div>
                                <p className="model-picker-card__description">Prefers the best available Copilot model and gives priority to o-series models when they exist.</p>
                            </button>

                            {filteredOptions.map((option) => {
                                const isCurrent = currentSelection === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={`model-picker-card${isCurrent ? ' model-picker-card--selected' : ''}`}
                                        onClick={() => onSelect(option.id)}
                                    >
                                        <div className="model-picker-card__header">
                                            <div>
                                                <strong>{option.label}</strong>
                                                <span className="model-picker-card__provider">{option.provider}</span>
                                            </div>
                                            {isCurrent ? <span className="model-picker-card__current">Current</span> : null}
                                        </div>
                                        <div className="model-picker-card__meta">
                                            <span>Provider: {option.provider}</span>
                                            <span>Family: {option.family}</span>
                                            <span>Version: {option.version || 'n/a'}</span>
                                            {option.costPriority ? <span>Cost / priority: {option.costPriority}</span> : null}
                                        </div>
                                        <p className="model-picker-card__description">{option.description || 'No additional description available.'}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
