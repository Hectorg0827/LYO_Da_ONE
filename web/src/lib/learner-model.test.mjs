import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTERY_CONFIDENCE_FLOOR,
  conceptFromDueReview,
  confidenceAfterHints,
  deriveMasteryState,
  evidenceFromAnswerCheck,
  evidenceFromClassroomSubmission,
  isStrongerEvidence,
  masteryPercent,
  normalizeEvidenceKind,
  normalizeMastery,
  transcriptLabelFor,
  shouldLeadWithConcepts,
  hasConceptEvidence,
} from './learner-model.mjs';

const strong = (kind) => ({ kind, confidence: 1 });

// ─── The evidence ladder ─────────────────────────────────────────────────────

test('application is stronger evidence than exposure', () => {
  assert.equal(isStrongerEvidence('application', 'exposure'), true);
  assert.equal(isStrongerEvidence('exposure', 'application'), false);
});

test('transfer is stronger evidence than recognition', () => {
  assert.equal(isStrongerEvidence('transfer', 'recognition'), true);
  assert.equal(isStrongerEvidence('recognition', 'transfer'), false);
});

test("the classroom's wire vocabulary maps onto the ladder", () => {
  // sdui_models.py sends these four and calls retention "retrieval".
  assert.equal(normalizeEvidenceKind('explanation'), 'explanation');
  assert.equal(normalizeEvidenceKind('application'), 'application');
  assert.equal(normalizeEvidenceKind('transfer'), 'transfer');
  assert.equal(normalizeEvidenceKind('retrieval'), 'retention');
});

test('an unrecognised evidence type never advances a rung', () => {
  // A new server-side type must not be silently scored — as exposure, and
  // certainly not as transfer.
  assert.equal(normalizeEvidenceKind('vibes'), null);
  assert.equal(deriveMasteryState([{ kind: 'vibes', confidence: 1 }]), 'NOT_SEEN');
});

// ─── Mastery is not granted cheaply ──────────────────────────────────────────

test('one correct answer cannot create full mastery', () => {
  const { evidence } = evidenceFromAnswerCheck({ correct: true, bailed_out: false });
  assert.equal(deriveMasteryState(evidence), 'RECOGNIZED');
  assert.notEqual(deriveMasteryState(evidence), 'MASTERED');
});

test('recognition alone does not confirm deeper understanding', () => {
  assert.equal(deriveMasteryState([strong('recognition')]), 'RECOGNIZED');
});

test('being taught is not evidence of anything', () => {
  assert.equal(deriveMasteryState([{ kind: 'exposure', confidence: 0 }]), 'EXPOSED');
  assert.equal(deriveMasteryState([]), 'NOT_SEEN');
});

test('mastery requires application, transfer and retention together', () => {
  // Any two of the three is not enough, however confident.
  assert.notEqual(deriveMasteryState([strong('application'), strong('transfer')]), 'MASTERED');
  assert.notEqual(deriveMasteryState([strong('application'), strong('retention')]), 'MASTERED');
  assert.notEqual(deriveMasteryState([strong('transfer'), strong('retention')]), 'MASTERED');

  assert.equal(
    deriveMasteryState([strong('application'), strong('transfer'), strong('retention')]),
    'MASTERED',
  );
});

test('shaky evidence reaches the rung but not mastery', () => {
  const shaky = MASTERY_CONFIDENCE_FLOOR - 0.01;
  const evidence = [
    { kind: 'application', confidence: 1 },
    { kind: 'transfer', confidence: shaky },
    { kind: 'retention', confidence: 1 },
  ];
  // The learner did transfer it — that is recorded — but a barely-scraped
  // transfer is not proof of durable mastery.
  assert.equal(deriveMasteryState(evidence), 'RETAINED');
});

test('the strongest rung reached is what gets reported', () => {
  assert.equal(
    deriveMasteryState([strong('exposure'), strong('recognition'), strong('application')]),
    'APPLIED',
  );
});

test('delayed retrieval is what moves a concept to RETAINED', () => {
  assert.equal(deriveMasteryState([strong('application')]), 'APPLIED');
  assert.equal(deriveMasteryState([strong('application'), strong('retention')]), 'RETAINED');
});

// ─── Skipping and hints are not failure ──────────────────────────────────────

test('a skipped question is neutral, not incorrect', () => {
  const skipped = evidenceFromAnswerCheck({ bailed_out: true, correct: false });
  assert.equal(skipped.skipped, true);
  assert.deepEqual(skipped.evidence, []);
  // Crucially it does not read as evidence of failure.
  assert.equal(deriveMasteryState(skipped.evidence), 'NOT_SEEN');
});

test('hints damp confidence without demoting the rung', () => {
  const unaided = evidenceFromAnswerCheck({ correct: true });
  const helped = evidenceFromAnswerCheck({ correct: true }, { hintLevel: 'worked_step' });

  assert.equal(helped.evidence[0].kind, 'recognition');
  assert.ok(helped.evidence[0].confidence < unaided.evidence[0].confidence);
  assert.ok(helped.evidence[0].confidence > 0);
});

test('more support means less confidence', () => {
  const nudged = confidenceAfterHints(1, 'nudge');
  const walked = confidenceAfterHints(1, 'worked_step');
  const shown = confidenceAfterHints(1, 'full_example');
  assert.ok(nudged > walked && walked > shown);
  assert.equal(confidenceAfterHints(1, null), 1);
});

// ─── Misconceptions ──────────────────────────────────────────────────────────

test('an incorrect answer records the misconception and only exposure', () => {
  const wrong = evidenceFromAnswerCheck({
    correct: false,
    bailed_out: false,
    misconception: 'treats the denominator as additive',
  });
  assert.equal(wrong.misconception, 'treats the denominator as additive');
  assert.equal(deriveMasteryState(wrong.evidence), 'EXPOSED');
});

test('a misconception is kept even when the retry lands', () => {
  const right = evidenceFromAnswerCheck({
    correct: true,
    misconception: 'confuses mass and weight',
  });
  // Remediation needs to know what was wrong, not just that it is now right.
  assert.equal(right.misconception, 'confuses mass and weight');
});

// ─── The client does not grade ───────────────────────────────────────────────

test('a classroom submission the server did not accept is only exposure', () => {
  const component = { evidence_type: 'transfer', concept_id: 'c-1' };

  const accepted = evidenceFromClassroomSubmission(component, { accepted: true });
  assert.equal(deriveMasteryState(accepted.evidence), 'TRANSFERRED');
  assert.equal(accepted.conceptId, 'c-1');

  // Submitting is not demonstrating. The server's verdict decides.
  const rejected = evidenceFromClassroomSubmission(component, { accepted: false });
  assert.equal(deriveMasteryState(rejected.evidence), 'EXPOSED');
});

// ─── One scale, everywhere ───────────────────────────────────────────────────

test('mastery normalises to 0..1 whichever scale it arrives on', () => {
  // The backend stores 0..1; at least one renderer assumed 0..100.
  assert.equal(normalizeMastery(0.7), 0.7);
  assert.equal(normalizeMastery(70), 0.7);
  assert.equal(masteryPercent(0.7), 70);
  assert.equal(masteryPercent(70), 70);
});

test('never assessed is not the same claim as assessed at zero', () => {
  assert.equal(normalizeMastery(null), null);
  assert.equal(normalizeMastery(undefined), null);
  assert.equal(normalizeMastery(Number.NaN), null);
  assert.equal(normalizeMastery(0), 0);
  assert.equal(masteryPercent(null), null);
});

test('out-of-range mastery is clamped rather than rendered', () => {
  assert.equal(normalizeMastery(-5), 0);
  assert.equal(normalizeMastery(140), 1);
  assert.equal(masteryPercent(140), 100);
});

// ─── Cross-surface: one learner record ───────────────────────────────────────

test('a due review reads as the same learner state chat produced', () => {
  const concept = conceptFromDueReview({
    skill_id: 'quadratic_functions',
    mastery_level: 0.62,
    days_overdue: 3,
    last_misconception: 'expands the square termwise',
  });

  assert.equal(concept.conceptId, 'quadratic_functions');
  assert.equal(concept.mastery, 0.62);
  assert.equal(concept.daysOverdue, 3);
  assert.equal(concept.misconception, 'expands the square termwise');
  assert.equal(concept.dueForRetrieval, true);
});

test('a due review on the percent scale lands on the same number', () => {
  // Whichever scale the surface happens to send, the learner record agrees.
  assert.equal(conceptFromDueReview({ mastery_level: 62 }).mastery, 0.62);
  assert.equal(conceptFromDueReview({ mastery_level: 0.62 }).mastery, 0.62);
});

test('a review row with no mastery yet reports none, not zero', () => {
  assert.equal(conceptFromDueReview({ skill_id: 'x' }).mastery, null);
  assert.equal(conceptFromDueReview({ skill_id: 'x' }).daysOverdue, 0);
});

// ─── Naming a demonstration back to the learner ──────────────────────────────

test('a demonstration is named by the rung it was actually asked for', () => {
  // The classroom transcript previously labelled every submission
  // "Application", including explanation and recall prompts.
  assert.equal(transcriptLabelFor('explanation'), 'Explanation');
  assert.equal(transcriptLabelFor('application'), 'Application');
  assert.equal(transcriptLabelFor('transfer'), 'Transfer');
  assert.equal(transcriptLabelFor('retrieval'), 'Recall');
});

test('an unknown prompt type gets a neutral label, not a guessed rung', () => {
  assert.equal(transcriptLabelFor(undefined), 'Answer');
  assert.equal(transcriptLabelFor('something_new'), 'Answer');
});

// ─── What Home leads with ────────────────────────────────────────────────────

test('Home leads with concepts once there is one to count', () => {
  assert.equal(shouldLeadWithConcepts({ total: 1, learned: 1 }), true);
  assert.equal(shouldLeadWithConcepts({ total: 12, mastered: 3 }), true);
});

test('a learner with no evidence yet is not shown three zeroes', () => {
  // Evidence only exists for work done since the learner model started
  // recording it. Someone with a year of XP and no evidence would otherwise
  // be told they have mastered nothing — a worse lie than showing their XP.
  assert.equal(shouldLeadWithConcepts({ total: 0, learned: 0, mastered: 0 }), false);
});

test('an unavailable summary falls back rather than rendering zeroes', () => {
  assert.equal(shouldLeadWithConcepts(null), false);
  assert.equal(shouldLeadWithConcepts(undefined), false);
});

test('a malformed summary is not trusted into the headline', () => {
  assert.equal(shouldLeadWithConcepts({}), false);
  assert.equal(shouldLeadWithConcepts({ total: 'lots' }), false);
  assert.equal(shouldLeadWithConcepts({ total: NaN }), false);
  assert.equal(shouldLeadWithConcepts('12'), false);
});

test('proving a concept counts as real activity on its own', () => {
  // Someone who demonstrated a concept in Chat but never earned an XP point
  // is not a stranger; greeting them with the front door discards what they
  // already showed us.
  assert.equal(hasConceptEvidence({ total: 2 }), true);
  assert.equal(hasConceptEvidence({ total: 0 }), false);
  assert.equal(hasConceptEvidence(null), false);
});
