import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPLORABLE_EVIDENCE_KIND,
  EXPLORABLE_KINDS,
  canRenderExplorable,
  positionField,
  trackOffsets,
} from './explorable.mjs';
import { EVIDENCE_KINDS } from './learner-model.mjs';

// ─── What engaging with one proves ───────────────────────────────────────────

test('moving an explorable is exposure, not a demonstration', () => {
  // The learner met the idea. They have not shown they can use it — the check
  // below the explorable is still where that happens.
  assert.equal(EXPLORABLE_EVIDENCE_KIND, 'exposure');
  assert.ok(EVIDENCE_KINDS.includes(EXPLORABLE_EVIDENCE_KIND));
});

test('exposure is the weakest rung on the shared ladder', () => {
  assert.equal(EVIDENCE_KINDS.indexOf(EXPLORABLE_EVIDENCE_KIND), 0);
});

// ─── Geometry ────────────────────────────────────────────────────────────────

test('a number line reads its positions from value', () => {
  assert.equal(positionField('number_line'), 'value');
});

test('a timeline reads its positions from year', () => {
  assert.equal(positionField('timeline'), 'year');
});

test('points are spread across the whole track', () => {
  const offsets = trackOffsets(
    [{ value: 0 }, { value: 0.5 }, { value: 1 }],
    'number_line'
  );
  assert.deepEqual(offsets, [0, 0.5, 1]);
});

test('a timeline handles years before zero', () => {
  const offsets = trackOffsets([{ year: -500 }, { year: 0 }, { year: 500 }], 'timeline');
  assert.deepEqual(offsets, [0, 0.5, 1]);
});

test('the track does not start at zero just because the data does not', () => {
  // 1789 and 1799 should span the whole line, not huddle at the right edge.
  const offsets = trackOffsets([{ year: 1789 }, { year: 1799 }], 'timeline');
  assert.deepEqual(offsets, [0, 1]);
});

test('identical positions do not stack every point on one spot', () => {
  // The composer rejects this server-side, but a stored block from a looser
  // producer could still arrive, and dividing by zero fails invisibly.
  const offsets = trackOffsets([{ value: 3 }, { value: 3 }], 'number_line');
  assert.ok(offsets.every((o) => Number.isFinite(o)));
});

test('a missing or unparseable position is treated as zero, not NaN', () => {
  const offsets = trackOffsets(
    [{ value: 0 }, {}, { value: 'later' }, { value: 10 }],
    'number_line'
  );
  assert.ok(offsets.every((o) => Number.isFinite(o)));
});

test('no points is an empty track, not a crash', () => {
  assert.deepEqual(trackOffsets([], 'number_line'), []);
  assert.deepEqual(trackOffsets(null, 'number_line'), []);
  assert.deepEqual(trackOffsets(undefined, 'timeline'), []);
});

// ─── What is drawable ────────────────────────────────────────────────────────

test('a real explorable renders', () => {
  assert.equal(
    canRenderExplorable({
      kind: 'number_line',
      prompt: 'Place 3/4',
      points: [{ label: '0', value: 0 }, { label: '1', value: 1 }],
    }),
    true
  );
});

test('one point is a dot, not a representation', () => {
  // Rendering it would take the space of a representation while showing
  // nothing, and hide the prose fallback in the process.
  assert.equal(
    canRenderExplorable({ kind: 'timeline', points: [{ label: 'a', year: 1 }] }),
    false
  );
});

test('a kind this client cannot draw is refused', () => {
  assert.equal(
    canRenderExplorable({ kind: 'hyperbolic_manifold', points: [{}, {}] }),
    false
  );
});

test('every declared kind is one the client can draw', () => {
  for (const kind of EXPLORABLE_KINDS) {
    assert.equal(canRenderExplorable({ kind, points: [{}, {}] }), true);
  }
});

test('malformed content is refused rather than half-drawn', () => {
  for (const content of [null, undefined, 'nope', 42, {}, { kind: 'timeline' }]) {
    assert.equal(canRenderExplorable(content), false);
  }
});
