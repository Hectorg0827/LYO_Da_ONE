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

import { readFileSync } from 'node:fs';

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

function requireText(source, expected, label) {
  if (!source.includes(expected)) failures.push(`${label}: missing ${JSON.stringify(expected)}`);
}

function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) failures.push(`${label}: forbidden ${JSON.stringify(forbidden)}`);
}

function rejectPattern(source, pattern, label) {
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
requireText(home, 'showLearnerDashboard', 'Home gates the zero dashboard');

// The seeded opening turn is what makes "I have a test" reach the backend's
// TEST_PREP intent rather than a client-side mock of it.
requireText(chatInterface, "searchParams.get('prompt')", 'Chat accepts a seeded opening turn');
requireText(chatInterface, 'seededOnce', 'Chat sends the seeded turn exactly once');

// ── 3. Due reviews are the learner's, not Chat's ─────────────────────────────

rejectPattern(
  nextForYou,
  /dueReviews\s*:\s*\[/,
  'Next-for-you seeded review list',
);
requireText(nextForYou, 'dueReviews()', 'Home reads the real review schedule');
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

if (failures.length) {
  console.error('Product-trust gate failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Product trust verified: no fabricated learner data, front door present, one brand.');
