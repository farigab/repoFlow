import { useEffect, useMemo, useState } from 'react';
import type { BranchCompareFile, BranchCompareResult, BranchSummary, DiffRequest, GraphSnapshot } from '../../../src/core/models';
import { vscode } from '../vscode';

interface BranchCompareModalProps {
  snapshot: GraphSnapshot;
  result: BranchCompareResult | null;
  onClose: () => void;
}

function formatBranch(branch: BranchSummary): string {
  return `${branch.current ? '* ' : ''}${branch.shortName}`;
}

function formatFileStatus(status: string): string {
  switch (status) {
    case 'A': return 'Added';
    case 'D': return 'Deleted';
    case 'M': return 'Modified';
    case 'R': return 'Renamed';
    case 'C': return 'Copied';
    default: return status;
  }
}

export function BranchCompareModal({ snapshot, result, onClose }: BranchCompareModalProps) {
  const localBranches = useMemo(() => snapshot.branches.filter((branch) => !branch.remote), [snapshot.branches]);
  const currentBranch = snapshot.localChanges.currentBranch ?? localBranches[0]?.shortName ?? '';
  const defaultBase = localBranches.find((branch) => branch.shortName === 'main' || branch.shortName === 'master')?.shortName ?? currentBranch;
  const fallbackTarget = localBranches.find((branch) => branch.shortName !== defaultBase)?.shortName ?? '';
  const defaultTarget = currentBranch || fallbackTarget;

  const [baseRef, setBaseRef] = useState(defaultBase);
  const [targetRef, setTargetRef] = useState(defaultTarget);
  const [pendingCompare, setPendingCompare] = useState<{ baseRef: string; targetRef: string } | null>(null);

  const matchingResult = result?.baseRef === baseRef && result.targetRef === targetRef ? result : null;
  const isComparing = pendingCompare?.baseRef === baseRef && pendingCompare.targetRef === targetRef && matchingResult == null;

  useEffect(() => {
    if (matchingResult) {
      setPendingCompare(null);
    }
  }, [matchingResult]);

  const handleCompare = () => {
    if (!baseRef || !targetRef || baseRef === targetRef) return;
    setPendingCompare({ baseRef, targetRef });
    vscode.postMessage({ type: 'compareBranches', payload: { repoRoot: snapshot.repoRoot, baseRef, targetRef } });
  };

  const handleOpenChangedFileDiff = (file: BranchCompareFile) => {
    const request: DiffRequest = {
      repoRoot: snapshot.repoRoot,
      commitHash: targetRef,
      parentHash: baseRef,
      filePath: file.path,
      originalPath: file.originalPath
    };

    vscode.postMessage({ type: 'openDiff', payload: request });
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Compare Branches">
        <header className="modal__header modal__header--hero">
          <div className="modal__title-group">
            <span className="modal__eyebrow">Repository tools</span>
            <h2>Compare Branches</h2>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            <i className="codicon codicon-close" aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body">
          <section className="settings-section">
            <h3 className="settings-section__title">Select Branches</h3>
            <div className="settings-row">
              <label className="settings-row__label" htmlFor="cmp-base">Base branch</label>
              <select id="cmp-base" className="settings-input settings-input--wide" value={baseRef} onChange={(event) => setBaseRef(event.target.value)}>
                {localBranches.map((branch) => <option key={`base-${branch.name}`} value={branch.shortName}>{formatBranch(branch)}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-row__label" htmlFor="cmp-target">Target branch</label>
              <select id="cmp-target" className="settings-input settings-input--wide" value={targetRef} onChange={(event) => setTargetRef(event.target.value)}>
                {localBranches.map((branch) => <option key={`target-${branch.name}`} value={branch.shortName}>{formatBranch(branch)}</option>)}
              </select>
            </div>
            <button type="button" disabled={!baseRef || !targetRef || baseRef === targetRef || isComparing} onClick={handleCompare}>
              {isComparing ? 'Comparing...' : 'Compare'}
            </button>
          </section>

          {isComparing ? (
            <section className="settings-section compare-state">
              <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
              <span>Comparing {targetRef} with {baseRef}...</span>
            </section>
          ) : null}

          {matchingResult ? (
            <section className="settings-section compare-result">
              <h3 className="settings-section__title">Result</h3>
              <div className="compare-metrics" aria-label="Branch comparison summary">
                <div className="compare-metric">
                  <span className="compare-metric__value">{matchingResult.ahead}</span>
                  <span className="compare-metric__label">ahead</span>
                </div>
                <div className="compare-metric">
                  <span className="compare-metric__value">{matchingResult.behind}</span>
                  <span className="compare-metric__label">behind</span>
                </div>
                <div className="compare-metric">
                  <span className="compare-metric__value">{matchingResult.files.length}</span>
                  <span className="compare-metric__label">files</span>
                </div>
              </div>
              <p className="compare-summary">{matchingResult.targetRef} compared with {matchingResult.baseRef}</p>
              <div className="compare-columns">
                <div>
                  <h4>Commits in target ({matchingResult.commitsAhead.length})</h4>
                  <div className="compare-list">
                    {matchingResult.commitsAhead.length > 0
                      ? matchingResult.commitsAhead.map((commit) => (
                        <div className="compare-list__item" key={`ahead-${commit.hash}`}>
                          <code>{commit.shortHash}</code>
                          <span>{commit.subject}</span>
                        </div>
                      ))
                      : <div className="compare-list__empty">No commits only in target.</div>}
                  </div>
                </div>
                <div>
                  <h4>Commits in base ({matchingResult.commitsBehind.length})</h4>
                  <div className="compare-list">
                    {matchingResult.commitsBehind.length > 0
                      ? matchingResult.commitsBehind.map((commit) => (
                        <div className="compare-list__item" key={`behind-${commit.hash}`}>
                          <code>{commit.shortHash}</code>
                          <span>{commit.subject}</span>
                        </div>
                      ))
                      : <div className="compare-list__empty">No commits only in base.</div>}
                  </div>
                </div>
              </div>
              <div>
                <h4>Changed files</h4>
                <div className="compare-list">
                  {matchingResult.files.length > 0
                    ? matchingResult.files.map((file) => (
                      <button
                        type="button"
                        className="compare-file"
                        key={`${file.status}-${file.path}`}
                        onClick={() => handleOpenChangedFileDiff(file)}
                        title={`Open native diff for ${file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}`}
                      >
                        <span className={`compare-file__status compare-file__status--${file.status.toLowerCase()}`}>{formatFileStatus(file.status)}</span>
                        <span className="compare-file__path" title={file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}>
                          {file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}
                        </span>
                        <span className="compare-file__stats">+{file.additions} / -{file.deletions}</span>
                        <i className="codicon codicon-diff" aria-hidden="true" />
                      </button>
                    ))
                    : <div className="compare-list__empty">No file differences between branch tips.</div>}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
