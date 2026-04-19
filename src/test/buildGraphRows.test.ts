import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGraphRows } from '../application/graph/buildGraphRows';
import type { CommitSummary } from '../core/models';

function commit(hash: string, parents: string[]): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 8),
    parentHashes: parents,
    authorName: 'Test',
    authorEmail: 'test@example.com',
    authoredAt: '2026-01-01T00:00:00Z',
    subject: hash,
    refs: [],
    isHead: false,
    isDirtyHead: false
  };
}

test('buildGraphRows keeps first-parent history on same lane', () => {
  const graph = buildGraphRows([
    commit('aaaa1111', ['bbbb2222']),
    commit('bbbb2222', ['cccc3333']),
    commit('cccc3333', [])
  ]);

  assert.equal(graph.rows.length, 3);
  assert.equal(graph.rows[0].lane, 0);
  assert.equal(graph.rows[1].lane, 0);
  assert.equal(graph.rows[2].lane, 0);
});

test('buildGraphRows assigns merge parents to secondary lanes', () => {
  const graph = buildGraphRows([
    commit('aaaa1111', ['bbbb2222', 'dddd4444']),
    commit('bbbb2222', ['cccc3333']),
    commit('dddd4444', ['eeee5555']),
    commit('cccc3333', []),
    commit('eeee5555', [])
  ]);

  assert.equal(graph.rows[0].lane, 0);
  assert.equal(graph.rows[0].connections[0]?.lane, 0);
  assert.equal(graph.rows[0].connections[1]?.lane, 1);
  assert.ok(graph.maxLane >= 1);
});
