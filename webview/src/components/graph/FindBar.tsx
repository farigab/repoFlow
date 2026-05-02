import type { KeyboardEvent, RefObject } from 'react';

interface FindBarProps {
    inputRef: RefObject<HTMLInputElement | null>;
    searchQuery: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    currentMatchIndex: number;
    matchCount: number;
    onSearchQueryChange: (value: string) => void;
    onCaseSensitiveChange: (value: boolean) => void;
    onWholeWordChange: (value: boolean) => void;
    onUseRegexChange: (value: boolean) => void;
    onNextMatch: () => void;
    onPreviousMatch: () => void;
    onClose: () => void;
}

export function FindBar({
    inputRef,
    searchQuery,
    caseSensitive,
    wholeWord,
    useRegex,
    currentMatchIndex,
    matchCount,
    onSearchQueryChange,
    onCaseSensitiveChange,
    onWholeWordChange,
    onUseRegexChange,
    onNextMatch,
    onPreviousMatch,
    onClose
}: FindBarProps) {
    const handleFindKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPreviousMatch();
            else onNextMatch();
        } else if (event.key === 'Escape') {
            onClose();
        }
    };

    return (
        <div className="find-bar" role="search">
            <div className="find-bar__search-wrap">
                <i className="codicon codicon-search find-bar__search-icon" aria-hidden="true" />
                <input
                    ref={inputRef}
                    className="find-bar__input"
                    type="text"
                    placeholder="Find in history..."
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    onKeyDown={handleFindKeyDown}
                    aria-label="Find in commit history"
                    spellCheck={false}
                />
            </div>
            <div className="find-bar__sep" />
            <div className="find-bar__opts" role="group" aria-label="Search options">
                <button type="button" className={`find-bar__opt${caseSensitive ? ' find-bar__opt--on' : ''}`} title="Match Case" onClick={() => onCaseSensitiveChange(!caseSensitive)} aria-pressed={caseSensitive}>Aa</button>
                <button type="button" className={`find-bar__opt find-bar__opt--word${wholeWord ? ' find-bar__opt--on' : ''}`} title="Match Whole Word" onClick={() => onWholeWordChange(!wholeWord)} aria-pressed={wholeWord}>ab</button>
                <button type="button" className={`find-bar__opt${useRegex ? ' find-bar__opt--on' : ''}`} title="Use Regular Expression" onClick={() => onUseRegexChange(!useRegex)} aria-pressed={useRegex}>.*</button>
            </div>
            <div className="find-bar__sep" />
            <span className={`find-bar__count${searchQuery && matchCount === 0 ? ' find-bar__count--no-results' : ''}`} aria-live="polite">
                {searchQuery
                    ? (matchCount === 0 ? 'No results' : `${currentMatchIndex + 1} / ${matchCount}`)
                    : '\u00a0'}
            </span>
            <div className="find-bar__nav-group">
                <button type="button" className="find-bar__nav" onClick={onPreviousMatch} title="Previous Match" disabled={matchCount === 0}>
                    <i className="codicon codicon-arrow-up" aria-hidden="true" />
                </button>
                <button type="button" className="find-bar__nav" onClick={onNextMatch} title="Next Match" disabled={matchCount === 0}>
                    <i className="codicon codicon-arrow-down" aria-hidden="true" />
                </button>
            </div>
            <div className="find-bar__sep find-bar__sep--narrow" />
            <button type="button" className="find-bar__close" onClick={onClose} title="Close" aria-label="Close search">
                <i className="codicon codicon-close" aria-hidden="true" />
            </button>
        </div>
    );
}
