/**
 * Product-trust gate (Phase A).
 *
 * Two invariants, both of which regressed easily because the offending code
 * looked harmless:
 *
 *  1. Production UI never presents fabricated activity as the learner's own.
 *     A seeded array or a Math.random() heatmap reads as a design detail in
 *     review and as a lie to the person looking at it.
 *
 *  2. A first-time visitor is met by the question the product answers and a
 *     door into the Classroom — not by a dashboard of their own nothing.
 *
 * See docs/CLASSROOM_ARCHITECTURE.md sections 5 and 6.
 */

import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * Assertions here run against code, not prose. A file that documents the
 * fabricated block it replaced would otherwise trip the very gate that
 * documentation exists to explain, which would push authors toward deleting
 * the explanation. Block and line comments are stripped first; string
 * literals are left intact because user-visible copy is exactly what several
 * of these checks are about.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const readCode = (path) => stripComments(read(path));
const failures = [];

const checked = new Set();

function requireText(source, expected, label) {
  checked.add(label);
  if (!source.includes(expected)) failures.push(`${label}: missing ${JSON.stringify(expected)}`);
}

function rejectText(source, forbidden, label) {
  checked.add(label);
  if (source.includes(forbidden)) failures.push(`${label}: forbidden ${JSON.stringify(forbidden)}`);
}

function rejectPattern(source, pattern, label) {
  checked.add(label);
  if (pattern.test(source)) failures.push(`${label}: forbidden pattern ${pattern}`);
}

const home = readCode('web/src/app/(main)/page.tsx');
const learningStats = readCode('web/src/components/profile/LearningStats.tsx');
const frontDoor = readCode('web/src/components/home/FrontDoor.tsx');
const nextForYou = readCode('web/src/components/home/NextForYou.tsx');
const chatInterface = readCode('web/src/components/chat/ChatInterface.tsx');
const layout = readCode('web/src/app/layout.tsx');
const manifest = read('web/public/manifest.json');
const sidebar = readCode('web/src/components/layout/Sidebar.tsx');
const chatSidebar = readCode('web/src/components/chat/ChatSidebar.tsx');
const entryContract = readCode('web/src/lib/entry-contract.mjs');
const learnerModel = readCode('web/src/lib/learner-model.mjs');
const lessonView = readCode('web/src/components/courses/LessonView.tsx');
const learningProgress = readCode('web/src/lib/learning-progress.ts');
const classroomStore = readCode('web/src/stores/classroom-store.ts');
const chatStore = readCode('web/src/stores/chat-store.ts');

// ── 1. No fabricated learner activity ────────────────────────────────────────

// The home page carried a hard-coded "Daily Challenges" list whose progress
// values were invented constants shown to every learner as their own.
rejectText(home, 'dailyChallenges', 'Home fabricated challenges');
rejectText(home, 'xpReward:', 'Home hard-coded reward data');
rejectText(home, "href=\"/challenges\"", 'Home dead challenges route');

// The stats panel generated a 28-day activity calendar from Math.random() and
// rendered it as the learner's study history.
rejectPattern(learningStats, /Math\.random\(\)/, 'Learning stats generated activity');
rejectText(learningStats, 'generateCalendarData', 'Learning stats generated calendar');
rejectText(learningStats, 'Activity Calendar', 'Learning stats fabricated calendar');
// ...alongside a hard-coded achievements grid with three arbitrarily unlocked.
rejectText(learningStats, 'unlocked: true', 'Learning stats fabricated achievements');
rejectText(learningStats, 'Week Warrior', 'Learning stats seeded badge');

// Nothing in these surfaces may invent a learner number.
for (const [source, label] of [
  [home, 'Home'],
  [learningStats, 'Learning stats'],
  [nextForYou, 'Next-for-you'],
  [frontDoor, 'Front door'],
]) {
  rejectPattern(source, /Math\.random\(\)/, `${label} generated learner data`);
}

// ── 2. The front door ────────────────────────────────────────────────────────

requireText(frontDoor, 'What do you want to learn?', 'Front door question');
requireText(frontDoor, 'Enter Classroom', 'Front door classroom CTA');
requireText(frontDoor, 'I have a test', 'Front door test-prep CTA');
// Both CTAs route through the shared entry contract, so Home, Chat, Courses
// and Test Prep cannot drift into opening the Classroom four different ways.
requireText(frontDoor, 'classroomEntryHref', 'Front door reaches the real classroom');
requireText(frontDoor, 'testPrepEntryHref', 'Front door reaches the real test-prep intent');
requireText(entryContract, '`/classroom?', 'Entry contract targets the real classroom route');
requireText(entryContract, "`/chat?prompt=", 'Entry contract targets the real test-prep intent');
// The backend router matches TEST_PREP on this phrasing; losing it silently
// downgrades the entry to a generic explanation.
requireText(entryContract, 'have a test', 'Test-prep entry keeps its intent phrasing');

// Home must actually mount it, or the CTAs above are unreachable.
requireText(home, '<FrontDoor', 'Home mounts the front door');
requireText(home, 'shouldShowLearnerDashboard', 'Home gates the zero dashboard');
// The gate must not treat "auth still loading" as "known learner": isLoading
// starts true, so that renders the zero dashboard to a signed-out visitor for
// the length of the auth request — the very thing the front door replaces.
rejectPattern(home, /authLoading\s*\|\|/, 'Home shows the dashboard while auth is unresolved');
rejectPattern(entryContract, /authLoading\s*\|\|/, 'Dashboard gate trusts an unresolved auth state');

// The seeded opening turn is what makes "I have a test" reach the backend's
// TEST_PREP intent rather than a client-side mock of it.
requireText(chatInterface, "searchParams.get('prompt')", 'Chat accepts a seeded opening turn');
// The guard must record that the turn was SENT, not that it was attempted.
// Marking the attempt loses it under a remount: the first pass sets the flag
// and is cancelled by its own cleanup, the second sees the flag and declines
// to retry, so nobody sends. Strict Mode makes that the normal case in dev.
requireText(chatInterface, 'seededSent.current = true;', 'Chat sends the seeded turn exactly once');
rejectPattern(
  chatInterface,
  /seededSent\.current = true;\s*\n\s*(let|await)/,
  'Seeded guard marks the attempt rather than the send',
);
// ...and sends it only once hydration has finished. A fresh load ends hydrate()
// by replacing the conversation list and opening a new chat, so a turn sent
// first lands in a conversation that is then discarded — the learner arrives at
// an empty chat with their "I have a test" opening turn missing.
requireText(chatInterface, 'await hydrate()', 'Seeded turn is ordered behind hydration');
// Awaiting hydrate() only orders anything because concurrent callers share the
// in-flight promise instead of returning early.
requireText(chatStore, 'hydrationInFlight', 'hydrate() is awaitable under concurrency');
rejectText(chatStore, 'if (get().isHydrating) return;', 'hydrate() releases callers early');

// ── 3. Due reviews are the learner's, not Chat's ─────────────────────────────

rejectPattern(
  nextForYou,
  /dueReviews\s*:\s*\[/,
  'Next-for-you seeded review list',
);
// NextForYou used to call `dueReviews()` directly. It now reads the
// recommendations endpoint, which merges the same review schedule with the
// concepts the learner is weakest on — a superset, from one call.
requireText(nextForYou, '.recommendations()', 'Home reads the real review schedule');
requireText(nextForYou, 'reviewEntryHref', 'Due reviews route through the entry contract');
requireText(entryContract, "mode: 'review'", 'Due reviews enter Classroom review mode');
// Retrieval must be generated fresh; replaying the stored question is a worse
// test of whether the concept still trips the learner up.
rejectText(nextForYou, 'last_question', 'Due reviews replay the old question');
rejectText(entryContract, 'last_question', 'Review entry replays the old question');

// ── 4. One learner model ─────────────────────────────────────────────────────

// Mastery must not be grantable by one cheap demonstration. These three are
// the product's definition of the word; losing any of them turns "mastered"
// back into "answered something once".
requireText(learnerModel, "'application', 'transfer', 'retention'", 'Mastery requires all three forms');
requireText(learnerModel, 'MASTERY_CONFIDENCE_FLOOR', 'Mastery has a confidence floor');
// Order in EVIDENCE_KINDS is meaning: evidenceRank compares by index.
requireText(
  learnerModel,
  "'exposure',",
  'Evidence ladder starts at exposure',
);
requireText(learnerModel, "retrieval: 'retention'", 'Wire vocabulary adapts onto the ladder');

// A skipped question is neutral and the client never grades. Both are easy to
// regress into "helpfully" scoring something the server did not.
requireText(learnerModel, 'result.bailed_out', 'Skipped questions stay neutral');
rejectPattern(learnerModel, /is_correct\s*=\s*true/, 'Client declares its own correctness');

// One scale. The backend stores 0..1; a renderer assuming 0..100 draws a
// confident wrong number rather than throwing.
for (const [source, label] of [
  [lessonView, 'Lesson view mastery bar'],
  [learningProgress, 'Course progress'],
]) {
  requireText(source, 'masteryPercent', `${label} uses the canonical mastery scale`);
}
rejectText(lessonView, '${card.mastery}%', 'Lesson view renders raw mastery as a percent');

// The transcript names the rung the component actually asked for.
requireText(classroomStore, 'transcriptLabelFor', 'Classroom transcript names the real rung');
rejectText(classroomStore, '`Application: ${trimmed}`', 'Classroom mislabels every submission');

// ── 3b. Home leads with what the learner knows ───────────────────────────────
//
// XP, hours and streak measure attendance. The headline is supposed to be
// concepts learned, mastered and retained — and those have to be earned from
// evidence server-side, never assembled on the client from whatever score is
// to hand.

requireText(home, 'api.personalization.conceptSummary(', 'Home reads the concept summary');
requireText(home, 'shouldLeadWithConcepts(', 'Home decides the headline by the shared rule');
requireText(home, "label: 'Mastered'", 'Home headlines concepts mastered');
requireText(home, "label: 'Retained'", 'Home headlines concepts retained');

// Concept counts must come from the server's summary, not be recomputed here.
for (const invented of ['.filter((c) => c.mastered', 'countMastered(', 'mastered += ']) {
  rejectText(home, invented, 'Home derives concept counts on the client');
}

// A learner with no evidence yet must not be shown three zeroes as a
// headline — that is the same fabrication this gate exists to prevent, in a
// more flattering vocabulary.
requireText(
  learnerModel,
  'return Number.isFinite(total) && total > 0;',
  'Concept headline requires at least one counted concept'
);

// ── 3c. The client cannot grade, because it is not told the answer ──────────
//
// The server strips `correct_index`, `explanation` and each option's
// `reveals` before a block leaves it. This gate pins the client half: nothing
// in the UI may reach for those fields to decide correctness.

const checkBlock = readCode('web/src/components/chat/blocks/CheckBlock.tsx');

// The verdict comes from the server's result, never from the block content.
rejectText(checkBlock, 'content.correct_index', 'Check grades from the block instead of the verdict');
rejectText(checkBlock, 'content.explanation', 'Check reveals the explanation before answering');
requireText(checkBlock, 'result!.correct_index', 'Check marks the right option from the server verdict');

// Misconception tags name what choosing an option would say about the
// learner. They are the server's diagnosis, not something to render at them.
rejectText(checkBlock, 'option.reveals', 'Check renders an internal misconception tag');

// ── 3d. Explorables prove exposure, never more ──────────────────────────────
//
// A representation the learner can move through is a real teaching device,
// but manipulating one is not a demonstration. If engaging with it could
// award a rung, every lesson becomes a slider a learner can drag to mastery.

const explorable = readCode('web/src/lib/explorable.mjs');
const explorableBlock = readCode('web/src/components/chat/blocks/ExplorableBlock.tsx');

requireText(
  explorable,
  "EXPLORABLE_EVIDENCE_KIND = 'exposure'",
  'Explorable engagement claims more than exposure'
);

// The component reports engagement; it never states what that proved.
requireText(explorableBlock, 'recordExposure(', 'Explorable does not record engagement');
for (const claim of ['evidence_type', 'evidence_confidence', 'measurable_outcome']) {
  rejectText(explorableBlock, claim, `Explorable declares its own ${claim}`);
}

// ── 3e. "For you" means something ──────────────────────────────────────────
//
// Home headed the first four rows of the catalogue "Recommended For You" —
// identical for every learner. Not invented data, but a claim about the
// learner that nothing behind it supported.

rejectText(home, 'Recommended For You', 'Home calls the catalogue personalised');
// The reason a thing was chosen is assembled server-side, so every client
// says the same thing about the same learner — and so the learner can
// disagree with it.
requireText(nextForYou, '{item.detail}', 'Recommendations do not say why they were chosen');
// A failed call leaves the section silent rather than filled with something
// invented to occupy the space.
requireText(nextForYou, 'setItems([])', 'A failed recommendation call is not handled silently');

// ── 3f. Nothing supplementary may evict a guest ─────────────────────────────
//
// `request()` treats a 401 as a session expiry: it clears tokens and
// navigates to /auth/login. Home calls the concept summary on every load, so
// without `optionalAuth` a signed-out visitor is redirected off the very
// front door the page exists to show them. The explorable's exposure ping had
// the same problem: a click meant to select a point could end the session.

const apiClient = readCode('web/src/lib/api.ts');
const explorableBlock2 = readCode('web/src/components/chat/blocks/ExplorableBlock.tsx');
const authFailureTest = readCode('web/src/lib/auth-failure.test.mjs');

requireText(apiClient, 'optionalAuth', 'API client cannot make a call guest-safe');

// The 401 branch itself has now been wrong three times running, each fix
// causing the next problem, and every guard on it was a source assertion like
// these. So the decision was moved into `classifyAuthFailure`, where the four
// outcomes are unit-tested directly, and what is left to assert here is only
// the wiring: that `request()` still asks that rule, and does nothing
// irreversible before it answers.
requireText(apiClient, 'classifyAuthFailure(', 'The 401 decision is not delegated to a tested rule');
requireText(authFailureTest, 'classifyAuthFailure', 'The 401 rule is not exercised by tests');

// ...and a test that exists but never runs is worse than no test, because it
// reads as coverage. The web CI job used to name three test files by hand, so
// two suites added later — explorable and this one — sat green by absence.
// Assert the whole chain: CI runs `npm test`, `npm test` is a glob, and every
// suite on disk is therefore reached.
const ciWorkflow = read('.github/workflows/ci.yml');
const webTestScript = JSON.parse(read('web/package.json')).scripts?.test ?? '';
requireText(ciWorkflow, 'run: npm test', 'The web CI job does not run the web unit tests');
requireText(webTestScript, 'src/lib/*.test.mjs', 'The web test script names files instead of globbing');
// Named per suite, so relaxing the script back to a hand-written list fails
// with the name of the file that would have stopped running.
const runnable = webTestScript
  .split(/\s+/)
  .filter((word) => word.endsWith('.test.mjs'))
  .map((word) => new RegExp(`^${word.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`));
for (const suite of readdirSync(new URL('../web/src/lib', import.meta.url))) {
  if (!suite.endsWith('.test.mjs')) continue;
  const path = `src/lib/${suite}`;
  if (!runnable.some((pattern) => pattern.test(path))) {
    failures.push(`A test suite exists but never runs in CI: ${path}`);
  }
}

// Every outcome must still be handled. Dropping a case collapses it into the
// default — which clears tokens and navigates to /auth/login — and that is
// precisely the bug each of the three rounds ended in.
for (const outcome of ['RETURN_RETRY', 'REQUEST_FAILED', 'NOT_SIGNED_IN']) {
  requireText(apiClient, `case ${outcome}:`, `A 401 outcome falls through to logout: ${outcome}`);
}

// Everything between recognising the 401 and asking the rule: the refresh
// must happen for optional calls too (skipping it left a signed-in learner's
// Home sections empty for the whole visit), and nothing may log anyone out
// before the rule has decided anything.
const branchStart = apiClient.indexOf('res.status === 401');
const decisionAt = apiClient.indexOf('classifyAuthFailure(');
// If either anchor is gone the requires above already fail; an empty slice
// keeps the rejects from reporting nonsense on top of the real message.
const beforeDecision =
  branchStart === -1 || decisionAt === -1 ? '' : apiClient.slice(branchStart, decisionAt);
requireText(beforeDecision, 'await tryRefreshToken()', 'An expired token is not refreshed before deciding');
rejectText(beforeDecision, 'optionalAuth', 'Optional calls skip the token refresh');
rejectText(beforeDecision, 'clearTokens()', 'Tokens are cleared before the 401 is classified');
rejectText(beforeDecision, 'window.location', 'The learner is redirected before the 401 is classified');
for (const [call, label] of [
  ['concepts/summary', 'Concept summary'],
  ['recommendations?limit=', 'Recommendations'],
  ['/api/v1/evolution/events', 'Exposure logging'],
]) {
  // Scoped to the call itself — up to its closing `});` — so an
  // `optionalAuth` on the *next* endpoint cannot satisfy this one.
  const at = apiClient.indexOf(call);
  const rest = at === -1 ? '' : apiClient.slice(at);
  // Whichever comes first: the end of this call, or the start of the next
  // method. Bounding only on `});` swallowed the following call when this one
  // ended in a plain `);`, and its `optionalAuth` then satisfied this check.
  const bounds = [rest.indexOf('});'), rest.indexOf('async ')].filter((i) => i !== -1);
  const thisCall = bounds.length ? rest.slice(0, Math.min(...bounds)) : rest.slice(0, 400);
  // `optionalAuth: true`, not bare `optionalAuth`: the loose form is satisfied
  // by `optionalAuth: false`, which regresses the behaviour completely, and by
  // a misspelled key, which `request()` would silently ignore. A sibling check
  // on the test-prep page passed for exactly that reason until it was mutated.
  requireText(thisCall, 'optionalAuth: true', `${label} can evict a guest from Home`);
}

// ── 3i. Test prep never reports a measurement nobody took ───────────────────
//
// A plan with nothing assessed yet carries a readiness of 0. Rendering that
// as "0% ready" tells a learner they failed something nobody ever asked them
// — the same fabrication as the random activity heatmap, arrived at by
// arithmetic rather than by Math.random().
//
// The page must branch on the *kind* of answer, never on the number.

const testPrep = readCode('web/src/lib/test-prep.mjs');
const testPrepPage = readCode('web/src/app/(main)/test-prep/page.tsx');
const testPrepTest = readCode('web/src/lib/test-prep.test.mjs');

requireText(testPrep, "kind: 'unmeasured'", 'Test prep cannot tell "not started" from a measured zero');
requireText(testPrep, "kind: 'not_started'", 'A topic never assessed has no distinct standing');
requireText(testPrepTest, 'readinessHeadline', 'The readiness rules are not exercised by tests');

// The page reads the classified answer, not the raw figure. Reading
// `readiness.readiness` directly is how "0% ready" gets back on screen.
requireText(testPrepPage, 'readinessHeadline(', 'The page formats readiness itself instead of asking');
requireText(testPrepPage, "headline.kind === 'unmeasured'", 'The page has no branch for "nothing measured yet"');
requireText(testPrepPage, 'topicStanding(', 'The page formats a topic score itself instead of asking');
rejectPattern(
  testPrepPage,
  /\{\s*readiness\.readiness\s*\}/,
  'The page renders the raw readiness figure'
);
// `percent ?? 0` would collapse every unmeasured case back to zero, which is
// exactly the bug the `kind` field exists to prevent.
rejectPattern(testPrepPage, /percent\s*\?\?\s*0/, 'An unmeasured standing falls back to zero');

// Creating a plan is the whole point: without it, readiness reports on
// nothing, which is the state every learner was in before this page existed.
requireText(testPrepPage, 'api.testPrep.intakeTurn', 'Test prep cannot create a plan');
requireText(testPrepPage, 'api.testPrep.generatePlan', 'Test prep never turns intake into a plan');
// The server decides when intake is done. A client counting turns would
// generate a plan from a half-finished profile.
requireText(testPrep, 'turn.intake_complete === true', 'The client decides when intake is complete');

// A session enters the Classroom through the shared entry contract, so
// practice does not open in review mode here while it does everywhere else.
requireText(testPrep, 'practiceEntryHref(topic)', 'A practice session does not use the shared entry contract');
requireText(testPrep, 'reviewEntryHref(topic)', 'A review session does not use the shared entry contract');

// ── 3j. Finishing a session reports what the server measured ────────────────
//
// The completion route used to take `performance_score` from the client and
// store it as the learner's performance. It now derives the outcome from the
// evidence the server recorded and replies with what it found — including
// "nothing was graded", which is the common case for a session spent reading.
//
// So the client must send no score, and must not imply one it did not get.

requireText(testPrepPage, 'api.testPrep.completeSession', 'A session can be started but never finished');
requireText(testPrep, "kind: 'unscored'", 'A session with nothing graded cannot be told apart from a zero');
requireText(testPrepPage, "summary.kind === 'unscored'", 'The page has no branch for "nothing was graded"');
requireText(testPrepTest, 'completionSummary', 'The completion rules are not exercised by tests');

// The score is the server's to determine. Sending one is the §30 violation
// this endpoint was fixed for, whatever the field is called or where it is
// put. These two were deleted by an over-wide edit while the prose above them
// survived, which left the gate documenting a rule it no longer enforced —
// see REQUIRED_RULES at the foot of this file.
rejectText(apiClient, 'performance_score=', 'The client sends its own session score');
rejectPattern(
  apiClient,
  /performance_score:\s*[^,\n]/,
  'The client puts a session score in a request body'
);

// The plan view's state lives in a reducer so these combinations can be
// unit-tested. Four consecutive review findings on this page were different
// combinations of eighteen useStates, the last a defect in the fix for the one
// before — the same shape as the 401 branch, and the same remedy. What is left
// to assert here is that the page still asks the reducer rather than growing
// its own copy of the state back.
const testPrepState = readCode('web/src/lib/test-prep-state.mjs');
const testPrepStateTest = readCode('web/src/lib/test-prep-state.test.mjs');

requireText(testPrepPage, 'useReducer(testPrepReducer', 'The plan view manages its state ad hoc again');
rejectPattern(
  testPrepPage,
  /\bset(Stage|Sessions|Readiness|PlanId|Loading|Notice|Finishing)\(/,
  'The plan view mutates state outside the reducer'
);

// Every failure has somewhere to be said. `refreshFailed` was set and rendered
// nowhere for a whole commit, which made a failed refresh completely silent.
requireText(testPrepPage, 'staleWarning(state)', 'A stale or failed refresh is not shown to the learner');
// Each failure gets exactly one sentence in one place. Rendering the same note
// in the header and as the Today copy showed it twice on an empty day; letting
// a page-refresh failure overwrite "Nothing scheduled for today" threw away a
// fact we had; and reporting the failure only in the empty branch left a
// refresh that fails while keeping rows completely silent. All four
// combinations are decided in `todayCopy` and tested there.
requireText(testPrepPage, 'todayCopy(state', 'The Today section decides its own copy again');
requireText(testPrepStateTest, 'todayCopy', 'The Today copy is not exercised by tests');
requireText(testPrepState, 'planLoadFailed', 'A failed refresh cannot be told from having no plan');

// The transitions that caused rounds six through nine, covered by name.
for (const scenario of ['load_failed', 'finish_succeeded', 'details_loaded']) {
  requireText(testPrepStateTest, scenario, `The ${scenario} transition is not exercised by tests`);
}

// ── 3g. An unknown explorable must not eat the lesson ───────────────────────
//
// `canRenderBlock` decides whether MessageBubble may hide the prose fallback.
// It once accepted any string `kind` while the component drew only the kinds
// it knew, so an unrecognised kind left a gap where the lesson had been.

const canRender = readCode('web/src/components/chat/blocks/can-render.ts');
requireText(canRender, 'canRenderExplorable(content)', 'Render check re-implements the explorable rule');
rejectText(canRender, "str('kind')", 'Render check accepts an explorable kind it cannot draw');

// ── 3h. A weak concept is practised, not retrieved ──────────────────────────
//
// Every recommendation used to open review mode. For a concept the learner is
// weak on that asks them to retrieve a memory that was never formed, and logs
// any success as retention evidence it is not.

requireText(nextForYou, 'practiceEntryHref(', 'Weak concepts are sent to review mode');
requireText(entryContract, 'export function practiceEntryHref', 'No practice entry exists');
rejectPattern(
  entryContract,
  /export function practiceEntryHref[\s\S]{0,400}mode: 'review'/,
  'Practice entry opens review mode',
);

// ── 4. One consumer brand ────────────────────────────────────────────────────

for (const [source, label] of [
  [layout, 'Web document metadata'],
  [manifest, 'Web PWA manifest'],
  [sidebar, 'Web sidebar'],
  [chatSidebar, 'Web chat sidebar'],
]) {
  for (const variant of ['LYO Da ONE', 'LYOAI', 'LYO AI', 'Lyo AI']) {
    rejectText(source, variant, `${label} brand drift`);
  }
}
requireText(layout, "default: 'LYO',", 'Web canonical document title');
requireText(manifest, '"name": "LYO"', 'Web canonical app name');

// ── Rules that must never quietly stop running ──────────────────────────────
//
// Deleting an assertion makes a gate *greener*, so a passing run after an edit
// proves nothing about whether the edit removed a protection. That is not
// hypothetical: an over-wide edit to this file deleted both client-declared
// score checks while leaving their explanatory comment in place, and the gate
// went on passing — documenting a rule it no longer enforced.
//
// These are the rules whose absence would be worst: the ones that stop the
// product claiming things about a learner that nothing measured. If a label
// here never ran, the gate fails whatever else passed.
const REQUIRED_RULES = [
  'The client sends its own session score',
  'The client puts a session score in a request body',
  'Client declares its own correctness',
  'Test prep cannot tell "not started" from a measured zero',
  'A topic never assessed has no distinct standing',
  'The page renders the raw readiness figure',
  'An unmeasured standing falls back to zero',
  'A session with nothing graded cannot be told apart from a zero',
  'The plan view mutates state outside the reducer',
  'A stale or failed refresh is not shown to the learner',
  'The Today section decides its own copy again',
];

for (const rule of REQUIRED_RULES) {
  if (!checked.has(rule)) {
    failures.push(`A required gate rule was deleted rather than run: "${rule}"`);
  }
}

if (failures.length) {
  console.error('Product-trust gate failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Product trust verified: no fabricated learner data, front door present, one brand.');
