import { useMemo, useState } from 'react';
import type { BranchCompareResult, BranchSummary, GraphSnapshot } from '../../../src/core/models';
import { vscode } from '../vscode';

interface BranchCompareModalProps {
  snapshot: GraphSnapshot;
  result: BranchCompareResult | null;
  onClose: () => void;
}

export function BranchCompareModal({ snapshot, result, onClose }: BranchCompareModalProps) {
  const localBranches = useMemo(() => snapshot.branches.filter((branch) => !branch.remote), [snapshot.branches]);
  const currentBranch = snapshot.localChanges.currentBranch ?? localBranches[0]?.shortName ?? '';
  const defaultBase = localBranches.find((branch) => branch.shortName === 'main' || branch.shortName === 'master')?.shortName ?? currentBranch;
  const fallbackTarget = localBranches.find((branch) => branch.shortName !== defaultBase)?.shortName ?? '';
  const defaultTarget = currentBranch || fallbackTarget;

  const [baseRef, setBaseRef] = useState(defaultBase);
  const [targetRef, setTargetRef] = useState(defaultTarget);

  const handleCompare = () => {
    if (!baseRef || !targetRef || baseRef === targetRef) return;
    vscode.postMessage({ type: 'compareBranches', payload: { repoRoot: snapshot.repoRoot, baseRef, targetRef } });
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const formatBranch = (branch: BranchSummary) => `${branch.current ? '● ' : ''}${branch.shortName}`;

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Compare Branches">
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
            <button type="button" disabled={!baseRef || !targetRef || baseRef === targetRef} onClick={handleCompare}>Compare</button>
          </section>

          {result && result.baseRef === baseRef && result.targetRef === targetRef && (
            <section className="settings-section">
              <h3 className="settings-section__title">Result</h3>
              <p className="compare-summary">{result.targetRef} is <strong>{result.ahead} ahead</strong> and <strong>{result.behind} behind</strong> {result.baseRef}.</p>
              <p className="compare-summary">Changed files from merge-base to target: <strong>{result.files.length}</strong></p>
              <div className="compare-columns">
                <div>
                  <h4>Commits in target ({result.commitsAhead.length})</h4>
                  <div className="compare-list">
                    {result.commitsAhead.map((commit) => <div key={`ahead-${commit.hash}`}>{commit.shortHash} {commit.subject}</div>)}
                  </div>
                </div>
                <div>
                  <h4>Commits in base ({result.commitsBehind.length})</h4>
                  <div className="compare-list">
                    {result.commitsBehind.map((commit) => <div key={`behind-${commit.hash}`}>{commit.shortHash} {commit.subject}</div>)}
                  </div>
                </div>
              </div>
              <div>
                <h4>Changed files</h4>
                <div className="compare-list">
                  {result.files.map((file) => <div key={`${file.status}-${file.path}`}>{file.status} {file.path} (+{file.additions}/-{file.deletions})</div>)}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
