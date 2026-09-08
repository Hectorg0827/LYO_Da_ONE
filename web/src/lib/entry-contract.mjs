/**
 * Entry contract — how any surface hands a learner to the Classroom.
 *
 * Home, Chat, Courses and Test Prep all need to open the Classroom, and each
 * one building its own query string is how the four of them drift into
 * teaching slightly different things. The rules live here instead, next to
 * `classroom-contract.mjs`, which owns the wire format once the Classroom is
 * open.
 *
 * `.mjs` so the Node test runner and the cross-platform parity scripts can
 * import it directly, matching classroom-contract.mjs.
 */

import { normalizeClassroomMode } from './classroom-contract.mjs';

/**
 * The opening turn behind Home's "I have a test".
 *
 * Test Prep is a real backend intent (TEST_PREP in lyo_app/ai/router.py),
 * resolved from what the learner says. So the entry actually says it and lets
 * the router ask for subject, date and materials, rather than a client-side
 * mock of a test-prep wizard standing in front of it.
 */
export const TEST_PREP_OPENING_TURN =
  'I have a test coming up and I want to get ready for it.';

/** A default objective, so the Director always receives an intent. */
export function defaultObjective(topic) {
  return `Understand and apply ${topic}`;
}

/**
 * Open the Classroom on a topic.
 *
 * Returns null for an empty topic: a Classroom with nothing to teach is not a
 * destination, and callers should keep their CTA disabled rather than push an
 * empty session.
 */
export function classroomEntryHref({ topic, mode, objective, courseId, lessonId } = {}) {
  const cleanTopic = (topic ?? '').trim();
  if (!cleanTopic) return null;

  const params = new URLSearchParams({
    topic: cleanTopic,
    objective: (objective ?? '').trim() || defaultObjective(cleanTopic),
  });

  // Only pin a mode when one was asked for; the Classroom's own default
  // otherwise applies rather than this module second-guessing it.
  if (mode !== undefined) params.set('mode', normalizeClassroomMode(mode));
  if (courseId) params.set('courseId', courseId);
  if (lessonId) params.set('lessonId', lessonId);

  return `/classroom?${params.toString()}`;
}

/**
 * Open the Classroom in review mode for a concept whose spaced-repetition
 * schedule says it is due.
 *
 * Review mode carries no stored question: retrieval is generated fresh, since
 * replaying the exact question the learner already saw tests recall of that
 * question rather than of the concept.
 */
export function reviewEntryHref(conceptLabel) {
  return classroomEntryHref({
    topic: conceptLabel,
    mode: 'review',
    objective: `Retrieve and re-apply ${(conceptLabel ?? '').trim()}`,
  });
}

/** Open Chat on the Test Prep intent. */
export function testPrepEntryHref() {
  return `/chat?prompt=${encodeURIComponent(TEST_PREP_OPENING_TURN)}`;
}
