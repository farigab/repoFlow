import type { CommitSummary, GraphRow } from '../../core/models';

interface LaneState {
  nextLane: number;
  byCommit: Map<string, number>;
  available: number[];
}

function takeLane(state: LaneState): number {
  const reusable = state.available.shift();
  if (reusable !== undefined) {
    return reusable;
  }

  const lane = state.nextLane;
  state.nextLane += 1;
  return lane;
}

function releaseLane(state: LaneState, lane: number): void {
  if (!state.available.includes(lane)) {
    state.available.push(lane);
    state.available.sort((left, right) => left - right);
  }
}

export function buildGraphRows(commits: CommitSummary[]): { rows: GraphRow[]; maxLane: number } {
  const state: LaneState = {
    nextLane: 0,
    byCommit: new Map<string, number>(),
    available: []
  };

  const rows: GraphRow[] = [];
  let maxLane = 0;

  commits.forEach((commit, rowIndex) => {
    const existingLane = state.byCommit.get(commit.hash);
    const lane = existingLane ?? takeLane(state);

    state.byCommit.delete(commit.hash);

    const connections = commit.parentHashes.map((parentHash, parentIndex) => {
      let parentLane = state.byCommit.get(parentHash);

      if (parentLane === undefined) {
        parentLane = parentIndex === 0 ? lane : takeLane(state);
        state.byCommit.set(parentHash, parentLane);
      }

      maxLane = Math.max(maxLane, parentLane);

      return {
        parentHash,
        lane: parentLane
      };
    });

    if (commit.parentHashes.length === 0) {
      releaseLane(state, lane);
    } else {
      const firstParentLane = connections[0]?.lane;
      if (firstParentLane !== lane) {
        releaseLane(state, lane);
      }
    }

    rows.push({
      row: rowIndex,
      lane,
      connections,
      commit
    });

    maxLane = Math.max(maxLane, lane);
  });

  return {
    rows,
    maxLane
  };
}
