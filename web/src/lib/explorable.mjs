/**
 * Explorables: representations a learner can move through rather than read.
 *
 * Every subject was getting the same treatment — prose, then a multiple-choice
 * question. A number line for fractions and a timeline for a sequence of
 * events are not decoration; they are how those subjects are actually thought
 * about, and placing a fraction is a different act from reading about one.
 *
 * The geometry and the rules live here, apart from the component, so they can
 * be tested directly and so the parity gate can pin them.
 */

/** The representation kinds a client knows how to draw. */
export const EXPLORABLE_KINDS = Object.freeze(['number_line', 'timeline']);

/**
 * What engaging with an explorable proves.
 *
 * Exposure, and only exposure. The learner met the idea; they have not shown
 * they can use it. Moving a slider is not a demonstration, and the check
 * below the explorable is still where one happens.
 *
 * The server enforces this independently — any event posted by a client is
 * recorded as exposure whatever the body claims — so this constant documents
 * the rule rather than being the thing that holds it up.
 */
export const EXPLORABLE_EVIDENCE_KIND = 'exposure';

/** Which field carries a point's position, for each kind. */
export function positionField(kind) {
  return kind === 'timeline' ? 'year' : 'value';
}

/**
 * Where each point sits along the track, as a 0..1 fraction.
 *
 * The span falls back to 1 when every point shares a position. The composer
 * rejects such an explorable server-side, but a stored block from a looser
 * producer could still arrive — and dividing by zero would stack every point
 * on the same spot rather than failing visibly.
 */
export function trackOffsets(points, kind) {
  const field = positionField(kind);
  const values = (points || []).map((point) => {
    const raw = Number(point?.[field]);
    return Number.isFinite(raw) ? raw : 0;
  });
  if (!values.length) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value) => (value - min) / span);
}

/**
 * Is this block one a client can actually draw?
 *
 * Two points is the minimum: a track needs somewhere to go between. A
 * one-point explorable is a dot, and rendering it would take the space of a
 * representation while showing nothing.
 */
export function canRenderExplorable(content) {
  if (!content || typeof content !== 'object') return false;
  if (!EXPLORABLE_KINDS.includes(content.kind)) return false;
  return Array.isArray(content.points) && content.points.length >= 2;
}
