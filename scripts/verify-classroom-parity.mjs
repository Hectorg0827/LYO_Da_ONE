import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const failures = [];

function requireText(source, expected, label) {
  if (!source.includes(expected)) failures.push(`${label}: missing ${JSON.stringify(expected)}`);
}

function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) failures.push(`${label}: forbidden ${JSON.stringify(forbidden)}`);
}

const web = read('web/src/stores/classroom-store.ts');
const webContract = read('web/src/lib/classroom-contract.mjs');
const webSpeech = read('web/src/lib/browser-speech.ts');
const iosClassroom = read('Sources/Services/LivingClassroomService.swift');
const iosTts = read('Sources/Core/Networking/Endpoint.swift');
const iosModels = read('Sources/Models/SDUIModels.swift');
const iosView = read('Sources/Views/Classroom/ActiveLessonView.swift');
const iosClassroomView = read('Sources/Views/Main/Classroom/LivingClassroomView.swift');
const iosLegacyModel = read('Sources/Models/Classroom.swift');
const iosLegacyViewModel = read('Sources/ViewModels/ClassroomViewModel.swift');
const iosLegacyOverlay = read('Sources/Components/Classroom/QuickCheckOverlay.swift');
const androidClassroom = read(
  'android/app/src/main/java/com/lyo/app/ui/screens/classroom/ClassroomScreen.kt',
);
const androidVoice = read(
  'android/app/src/main/java/com/lyo/app/ui/screens/classroom/ClassroomVoicePlayer.kt',
);
const androidNavigation = read(
  'android/app/src/main/java/com/lyo/app/ui/navigation/LyoNavHost.kt',
);

for (const [source, label] of [
  [web, 'Web classroom'],
  [iosTts, 'iOS classroom'],
  [androidVoice, 'Android classroom'],
]) {
  requireText(source, '/api/v1/tts/synthesize', `${label} shared voice endpoint`);
}

requireText(webContract, 'language:', 'Web locale contract');
requireText(webContract, "client_contract_version: '2'", 'Web contract version');
requireText(webContract, "params.set('course_id'", 'Web course identity');
requireText(web, 'comp.language_code', 'Web component locale');
requireText(iosClassroom, 'component.languageCode ?? "auto"', 'iOS component locale');
requireText(androidClassroom, '"language_code"', 'Android component locale');

requireText(web, 'learnerTakesFloor()', 'Web interruption contract');
requireText(iosClassroom, 'bargeIn()', 'iOS interruption contract');
requireText(androidClassroom, 'beginLearnerInput()', 'Android interruption contract');
requireText(web, "if (!sendAction('skip_question'", 'Web offline-safe skip');
requireText(iosClassroom, 'guard isConnected, let task = webSocketTask', 'iOS offline-safe action');
requireText(iosView, 'guard onSkip(component) else { return false }', 'iOS offline-safe skip');
requireText(androidClassroom, 'if (sendAction(', 'Android offline-safe action');

for (const [source, label] of [
  [web, 'Web classroom'],
  [iosClassroomView, 'iOS classroom'],
  [androidClassroom, 'Android classroom'],
]) {
  requireText(source, 'skip_question', `${label} neutral skip`);
  requireText(source, 'request_hint', `${label} learner help`);
}

rejectText(web, 'resumePlayer(); // a classmate jumps in', 'Web unattended continuation');
rejectText(iosClassroom, 'startHesitationWatch(for: component)', 'iOS timed learner interruption');
rejectText(iosClassroom, 'self.startLocalLesson()', 'iOS platform-only classroom fallback');
rejectText(iosClassroom, 'LivingClassroomEngine()', 'iOS platform-only teaching engine');
rejectText(
  read('Sources/Views/Classroom/ActiveLessonView.swift'),
  'unlockAndAdvanceSoftly',
  'iOS answer auto-advance',
);

requireText(iosModels, 'case inputField = "InputField"', 'iOS application evidence UI');
requireText(webSpeech, 'SpeechRecognition', 'Web learner voice input');
requireText(androidClassroom, '"InputField"', 'Android application evidence UI');
requireText(androidClassroom, 'RecognizerIntent.ACTION_RECOGNIZE_SPEECH', 'Android learner voice input');
requireText(androidNavigation, 'ClassroomScreen(', 'Android live classroom route');
requireText(androidClassroom, '.addQueryParameter("course_id", courseId)', 'Android course identity');
requireText(androidClassroom, '.addQueryParameter("client_contract_version", "2")', 'Android contract version');
requireText(iosClassroom, 'URLQueryItem(name: "course_id"', 'iOS course identity');
requireText(iosClassroom, 'URLQueryItem(name: "client_contract_version", value: "2")', 'iOS contract version');

rejectText(iosLegacyViewModel, 'createMockQuickCheck', 'iOS hardcoded quick check');
rejectText(iosLegacyViewModel, 'Which part of y = mx + b', 'iOS algebra-only quick check');
requireText(iosLegacyModel, 'let quickCheck: QuickCheck?', 'iOS authored quick check contract');
rejectText(iosLegacyOverlay, 'Simplified for now', 'iOS tap-to-order stub');
rejectText(iosLegacyOverlay, 'Interactive Diagram', 'iOS diagram stub');

// ── iOS teaches through exactly one classroom ────────────────────────────────
//
// iOS carried four classroom entry points. LivingClassroomView is the only one
// MainTabView, EnhancedLyoHomeView or DiscoverView ever routed to; the other
// three were unreachable code that would drift out of step with the shared
// contract precisely because nothing exercised them.
//
// LivingClassroomEngine is the important one to keep out. It was an on-device
// teaching loop added because the server-pushed classroom could dead-end. That
// is a real failure worth fixing, but fixing it on the client makes iOS a
// pedagogically different product from web and Android — the safe fallback
// belongs server-side.
const REMOVED_IOS_CLASSROOMS = [
  'Sources/Services/LivingClassroomEngine.swift',
  'Sources/Services/LyoClassroomService.swift',
  'Sources/ViewModels/AgenticClassroomViewModel.swift',
  'Sources/Views/Main/Classroom/AgenticClassroomView.swift',
];

for (const path of REMOVED_IOS_CLASSROOMS) {
  if (existsSync(new URL(`../${path}`, import.meta.url))) {
    failures.push(`iOS classroom convergence: ${path} is back — one classroom, one contract`);
  }
}

// ── iOS study plans: no pretend persistence ─────────────────────────────────
//
// StudyPlanService claimed to persist a learner's study plan and did not. It
// POSTed to /api/v1/me/study_plans, which the server registers for GET only,
// so every call was a 405 that `try?` swallowed; and StudyPlanRecord could not
// have decoded a real response anyway (`id` is a UUID string on the wire, not
// an Int, and subject/topics/daily_breakdown are not on StudyPlanRead).
//
// Code that looks like persistence and is not hides the gap it leaves. The
// server does build durable plans, through intake/turn then plans/generate;
// until a client is wired to that, the honest state is no client integration.
const REMOVED_IOS_STUDY_PLANS = [
  'Sources/Services/StudyPlanService.swift',
  'Sources/Models/StudyPlanRecord.swift',
];

for (const path of REMOVED_IOS_STUDY_PLANS) {
  if (existsSync(new URL(`../${path}`, import.meta.url))) {
    failures.push(
      `iOS study plans: ${path} is back — it never persisted anything (see docs/CLASSROOM_ARCHITECTURE.md §7.4)`
    );
  }
}

// The specific call that 405'd. A client may read the plan list from this
// path; creating one goes through the intake flow, never a POST here.
for (const [file, label] of [
  ['Sources/Core/Networking/Endpoint.swift', 'iOS endpoints'],
  ['Sources/Views/Main/Hybrid/LyoOverlayView.swift', 'iOS chat overlay'],
]) {
  const source = read(file);
  if (/case\s+\.create:\s*\n\s*return\s+"\/api\/v1\/me\/study_plans"/.test(source)) {
    failures.push(`${label}: POST /api/v1/me/study_plans is a 405 — the server registers GET only`);
  }
}

if (failures.length) {
  console.error('AI Classroom parity gate failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('AI Classroom voice, locale, interruption, and learner-gating parity verified.');
