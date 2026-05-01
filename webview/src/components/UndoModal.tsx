import type { GraphSnapshot, UndoEntry } from '../../../src/core/models';
import { vscode } from '../vscode';

interface UndoModalProps {
  snapshot: GraphSnapshot;
  entries: UndoEntry[];
  onClose: () => void;
}

export function UndoModal({ snapshot, entries, onClose }: UndoModalProps) {
  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Undo Last Operation">
        <header className="modal__header modal__header--hero">
          <div className="modal__title-group">
            <span className="modal__eyebrow">Safety</span>
            <h2>Undo Last Operation</h2>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            <i className="codicon codicon-close" aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body">
          <p className="compare-summary">Choose a reflog point to reset to (hard reset).</p>
          <div className="compare-list">
            {entries.map((entry) => (
              <div key={entry.ref} className="undo-entry">
                <div>
                  <strong>{entry.ref}</strong> · {entry.shortHash}
                  <div>{entry.message}</div>
                </div>
                <button
                  type="button"
                  onClick={() => vscode.postMessage({ type: 'undoTo', payload: { repoRoot: snapshot.repoRoot, ref: entry.ref } })}
                >
                  Undo to here
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
