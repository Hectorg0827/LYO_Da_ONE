# LYO — Living AI Classroom Architecture Audit

Status: living document. Written before Phase A, updated as each phase lands.

This is an audit of what **actually exists today** across the four LYO
codebases, mapped onto the canonical learning loop. It exists so that we
converge on the strongest system already in the repos instead of adding an
n+1'th mastery engine.

Repos covered:

| Repo | Contents | Write access from this workstream |
| --- | --- | --- |
| `Hectorg0827/Lyo_Da_One` | Web (Next.js), iOS (SwiftUI), Android (Compose), parity scripts | yes |
| `Hectorg0827/LyoBackendJune` | FastAPI backend (`lyo_app/`) | read-only |

Because the backend is read-only from here, backend rows below are recorded
as **contract decisions** the clients code against, not as edits already made.

---

## 1. The canonical loop

```
USER INTENT
   -> LYO router / entry flow
   -> LIVING AI CLASSROOM
   -> CLASSROOM DIRECTOR          (chooses the pedagogical move)
   -> SCENE / TEACHING MOVE       (LLM fills content inside the move)
   -> LIVE LEARNING SURFACE       (board + voice + captions)
   -> LEARNER ACTION
   -> LEARNING EVENT
   -> EVIDENCE                    (exposure..retention, graded server-side)
   -> CANONICAL LEARNER MODEL
   -> MASTERY + RETENTION + MISCONCEPTIONS
   -> NEXT BEST PEDAGOGICAL ACTION
   -> CLASSROOM DIRECTOR
```

Every subsystem below is classified against this loop as one of:

- **CANONICAL** — the one true implementation; everything else adapts to it.
- **ADAPTER** — translates a legacy shape into the canonical one.
- **MIGRATION_ONLY** — retained solely so existing rows/users keep working.
- **LEGACY_ACTIVE** — still on a live code path; needs an adapter before removal.
- **SAFE_TO_REMOVE** — no imports, no routes, no tests, no platform depends on it.

---

## 2. Backend inventory (`lyo_app/`)

The backend contains **four** overlapping learning-state systems. This is the
single largest source of incoherence in the product.

| Module | Models | Classification | Notes |
| --- | --- | --- | --- |
| `lyo_app/ai_classroom/models.py` | `GraphCourse`, `LearningNode`, `LearningEdge`, `Concept`, `Misconception`, `MasteryState`, `ReviewSchedule`, `InteractionAttempt`, `CourseProgress` | **CANONICAL** | Richest model. Concept-graph based, has misconceptions, SM-2 review schedule, per-attempt history. This is the intended learner brain. |
| `lyo_app/personalization/models.py` | `LearnerState`, `LearnerMastery`, `AffectSample`, `SpacedRepetitionSchedule`, `MemoryInsight` | **LEGACY_ACTIVE** | Duplicates mastery and spaced repetition. `AffectSample` / `MemoryInsight` have no equivalent in `ai_classroom` and are worth folding in rather than dropping. |
| `lyo_app/events/models.py` | `LearningEvent` (52 lines) | **CANONICAL (thin)** | Correct concept, under-built. Should become the single write path into mastery. |
| `lyo_app/classroom/models.py` | `ClassroomSession`, `ClassroomInteraction` | **CANONICAL (session layer)** | Session/transport concern, not a competing learner model. Keep. |

### 2.1 What `MasteryState` is missing

`ai_classroom.MasteryState` today carries `mastery_score`, `confidence`,
`attempts`, `correct_count`, `incorrect_count`, `error_pattern`,
`misconception_tags`, `last_seen`, `last_correct`, `trend`.

It does **not** carry the evidence ladder. To satisfy the mastery standard it
needs:

- `evidence_level` — the highest rung reached (see §3)
- `retention_strength` — distinct from `confidence`; decays with time
- `last_demonstrated_at` — distinct from `last_seen` (exposure is not evidence)
- `next_review_at` — denormalised from `ReviewSchedule` for cheap Home reads

Until the backend adds these, clients derive `evidence_level` from the
event stream and treat it as advisory, never authoritative.

### 2.2 Convergence plan (backend, when writable)

1. `events.LearningEvent` becomes the **only** write path to mastery. Nothing
   else may mutate `MasteryState` directly.
2. `personalization.LearnerMastery` gets a read-through **ADAPTER** onto
   `ai_classroom.MasteryState`, then becomes MIGRATION_ONLY.
3. `personalization.SpacedRepetitionSchedule` folds into
   `ai_classroom.ReviewSchedule` (both are SM-2; the latter is more complete).
4. `AffectSample` and `MemoryInsight` move under the canonical learner model
   as signals the Director reads.

### 2.3 Correction: which table actually carries live data

An earlier draft of this document recommended converging **onto**
`ai_classroom.MasteryState` because its schema is richer. Reading the backend
with write access showed that recommendation was backwards on the facts.

`ai_classroom.MasteryState` is **read** by the classroom's scene engine before
every teaching decision, and written by nothing on the live path:
`graph_service` fires only from the playback routes, and `interaction_service`
has no callers at all. Meanwhile `personalization.LearnerMastery` is written
by every chat check and carries all the accumulated learner data there is.

So the Classroom has been adapting its teaching from a table Chat never fills.
A learner who demonstrated a concept in Chat arrived at the Classroom as a
stranger. Migrating rows between the two would have picked a winner; instead
both become views of one event stream, which is what lets them agree.

### 2.4 Backend convergence — what landed

| Change | Where (`LyoBackendJune`) |
| --- | --- |
| Server twin of the client's evidence vocabulary | `lyo_app/events/evidence.py` |
| Evidence columns on `LearningEvent` (concept, rung, confidence, hints, misconception, surface) | `lyo_app/events/models.py`, `alembic/versions/evidence_001_*` |
| Evidence projected into the table the Classroom reads | `lyo_app/events/mastery_projection.py` |
| Chat's check emits evidence | `lyo_app/api/v1/stream_lyo2.py` |
| Classroom's graded submissions emit evidence | `lyo_app/ai_classroom/scene_lifecycle_engine.py` |
| Projection exercised against a real database | `tests/test_mastery_projection_db.py` |

Three decisions worth keeping visible:

- **Concept identity.** Chat names concepts by slug; `MasteryState.concept_id`
  is foreign-keyed to `concepts.id`, which holds UUIDs. Slugs therefore go to
  `objective_id`, which has no foreign key, under a partial unique index on
  `(user_id, objective_id)`. Without that index SQL treats the null
  `concept_id` values as distinct and two concurrent checks create two rows.
- **No double counting.** Both surfaces already run a DKT update directly for
  the answer they are logging, so the event deliberately omits
  `skill_ids_json` — the field that asks the processor to run a second one.
- **Hidden rubrics stay hidden.** The transfer scorer's list of missed
  keywords is never written into the learner model. It is grading internals;
  stored there it would sit one render away from the screen.

Still open: `personalization.LearnerMastery` has not yet become an adapter
(step 2 above), and the SM-2 schedules have not been folded (step 3).

---

## 3. The evidence ladder

Mastery is never granted for watching, pressing Continue, spending time, or
receiving an explanation. It is granted for demonstrated evidence:

```
NOT_SEEN -> EXPOSED -> RECOGNIZED -> EXPLAINED -> APPLIED -> TRANSFERRED -> RETAINED -> MASTERED
```

| Rung | Earned by | Strength |
| --- | --- | --- |
| `exposure` | Instruction was delivered | none on its own |
| `recognition` | Correct selection in context | weak |
| `explanation` | Learner explains it acceptably | moderate |
| `application` | Correct use on a familiar problem | strong |
| `transfer` | Correct use in a novel context | strongest single form |
| `retention` | Correct retrieval after a real interval | confirms durability |

`MASTERED` requires high-confidence evidence across **application + transfer +
retention**, not a high score on any one of them.

Hints reduce the confidence attached to a rung; they never demote the rung and
asking for help is never scored as failure. A skipped question is neutral: it
produces no evidence in either direction.

---

## 4. Cross-platform client inventory

### 4.1 Shared contract (already exists — keep and extend)

`web/src/lib/classroom-contract.mjs` is the **CANONICAL** wire contract and is
already mirrored by the iOS and Android clients and enforced by
`scripts/verify-classroom-parity.mjs`.

It pins: classroom modes (`solo` / `classroom` / `challenge` / `review`), the
hint ladder (`nudge` / `principle` / `worked_step` / `full_example` /
`prerequisite`), `client_contract_version: '2'`, course/lesson/session
identity, locale, and reduced-motion.

This is the right shape. Phase B extends it with the learner-model contract
rather than introducing a second one.

### 4.2 Web

| Path | Role | Classification |
| --- | --- | --- |
| `web/src/lib/classroom-contract.mjs` | Wire contract | **CANONICAL** |
| `web/src/stores/classroom-store.ts` | Classroom session state, WS transport, board state | **CANONICAL** |
| `web/src/app/(main)/classroom/page.tsx` | Live classroom surface | **CANONICAL** |
| `web/src/components/classroom/*` | Board elements, explorable, caption sync, flow controls | **CANONICAL** |
| `web/src/stores/chat-store.ts` | Chat + `dueReviews` + server-graded answer checks | **LEGACY_ACTIVE** — owns spaced repetition that belongs to the learner model |
| `web/src/lib/learning-progress.ts` | Lesson completion / course progress | **ADAPTER** onto backend `CourseProgress` |
| `web/src/components/profile/LearningStats.tsx` | Profile stats | **SAFE_TO_REMOVE (fabricated parts)** — see §5 |

### 4.3 iOS (`Sources/`)

| Path | Role | Classification |
| --- | --- | --- |
| `Services/LivingClassroomService.swift` | WS transport, barge-in, locale | **CANONICAL** |
| `Views/Main/Classroom/LivingClassroomView.swift` | Live classroom surface | **CANONICAL** |
| `Views/Classroom/ActiveLessonView.swift` | Lesson rendering, offline-safe skip | **CANONICAL** |
| `Models/SDUIModels.swift` | Server-driven component catalog | **CANONICAL** |
| ~~`Services/LivingClassroomEngine.swift`~~ | On-device teaching engine | **REMOVED** in Phase C — unreachable, and a client-side teaching engine makes iOS a pedagogically different product (see §10) |
| `ViewModels/ClassroomViewModel.swift`, `Models/Classroom.swift` | Older classroom path | **LEGACY_ACTIVE** — parity gate pins its authored-quick-check contract |
| ~~`ViewModels/AgenticClassroomViewModel.swift`, `Views/Main/Classroom/AgenticClassroomView.swift`~~ | Third classroom path | **REMOVED** in Phase C — the two referenced only each other; nothing routed to either (see §10) |
| ~~`Services/LyoClassroomService.swift`~~ | Fourth classroom service | **REMOVED** in Phase C — unreachable duplicate WebSocket transport (see §10) |

iOS carried **four** classroom entry points; Phase C removed the three that
nothing routed to. `LivingClassroomView` / `LivingClassroomService` is now the
only one, and the parity gate fails if any of the other three reappears.

### 4.4 Android (`android/app/src/main/java/com/lyo/app/`)

| Path | Role | Classification |
| --- | --- | --- |
| `ui/screens/classroom/ClassroomScreen.kt` | Live classroom surface + WS | **CANONICAL** |
| `ui/screens/classroom/ClassroomVoicePlayer.kt` | Voice + barge-in | **CANONICAL** |
| `ui/classroom/catalog/*` | Board element catalog (Latex, Mermaid, Code, Chart, Quiz, TransferInput, ...) | **CANONICAL** |

Android is the cleanest of the three clients: one classroom, one catalog.

---

## 5. Fabricated learner data (Phase A target)

Production UI must never present invented activity as the learner's own.
Found in the web client:

| Location | Problem |
| --- | --- |
| `web/src/app/(main)/page.tsx` | `dailyChallenges` is a hard-coded array with invented `progress` values (`1/2` lessons, `7/10` minutes) rendered as this user's real challenge progress |
| `web/src/components/profile/LearningStats.tsx` | `generateCalendarData()` builds a 28-day activity heatmap from `Math.random()` and renders it as the learner's study history |
| `web/src/components/profile/LearningStats.tsx` | `achievements` is a hard-coded list with three arbitrarily marked `unlocked: true` |
| `web/src/app/(main)/page.tsx` | Zero-dashboard: a brand-new user is shown Level 1 / 0 XP / 0 hours / 0 courses rather than a reason to start |

Fix posture: real API data where an endpoint exists
(`api.gamification.achievements()`, `api.chat.dueReviews()`), an intentional
empty state where it does not, and no component at all where neither is
meaningful.

---

## 6. Spaced repetition is real but trapped

`api.chat.dueReviews()` -> `/api/v1/lyo2/chat/reviews/due` returns
`{ skill_id, days_overdue, mastery_level, last_misconception }` and is already
wired through `chat-store.ts` into `DueReviewsNudge.tsx`.

It correctly generates a **fresh** retrieval question rather than replaying the
old one.

The problem is scope: it is visible only inside Chat. Due reviews are a
property of the learner, not of a surface. They belong on Home, in Review mode,
and in exam readiness. Surfacing them on Home is Phase A; routing them into
Classroom Review mode is Phase C.

---

## 7. Phase plan against this audit

| Phase | Scope | Depends on backend writes |
| --- | --- | --- |
| **A — Product trust** | Remove fabricated data; new front door; surface due reviews on Home; unify branding; guest can reach Classroom | no |
| **B — Canonical learner intelligence** | Client-side canonical learner-model contract + adapters; Chat/Classroom/Test Prep read one state | partially |
| **C — Classroom core** | Collapse iOS's four classroom paths; Director owns move selection; Review mode | no |
| **D — Signature board** | Representation selection per subject; explorables emit evidence | no |
| **E — Test prep integration** | Diagnostic -> canonical mastery -> readiness -> classroom sessions | yes |
| **F — Product graph** | Home recommendations, Learning Around Me, Clips loop | no |

### 7.1 Phases D–F — what landed, and what the audit got wrong again

| Change | Where |
| --- | --- |
| Explorables: `number_line` and `timeline` on a lesson's representation section | `lyo_app/ai/lesson_composer.py`, `web/src/lib/explorable.mjs`, `ExplorableBlock.tsx` |
| Test Prep teaches and grades, so it produces evidence at all | `lyo_app/api/v1/stream_lyo2.py` |
| Home recommendations from the learner's own record, with reasons | `lyo_app/personalization/recommendations.py`, `NextForYou.tsx` |
| The classroom's failure path teaches instead of dead-ending | `lyo_app/ai_classroom/scene_lifecycle_engine.py` |
| One SM-2 and one schedule for both surfaces | `lyo_app/personalization/spaced_repetition.py` |
| One key per skill, with a merging migration | `alembic/versions/skillkey_001_*` |

**Three things this document said that were wrong**, all the same mistake —
recommending convergence onto the table with the better schema rather than the
one with the data:

1. `personalization` onto `ai_classroom.MasteryState` (corrected in §2.3).
2. `SpacedRepetitionSchedule` folds into `ReviewSchedule`, "the latter is more
   complete". Backwards for the same reason: `ReviewSchedule`'s only writers
   have no callers, so the classroom's `/review/today` served an empty queue to
   every learner while they had items genuinely due in the other table.
3. `LearnerMastery` should become a read-through adapter. With both tables now
   fed from one event stream they already agree, and turning the DKT estimate
   into a facade over a simpler score would be a downgrade, not a convergence.
   The step is dropped rather than deferred.

**What Test Prep's gap actually was.** Not "it does not log evidence" — it
never *graded* anything. Only `Intent.EXPLAIN` reached the lesson composer, so
a learner could work through a whole test-prep session without being asked a
question the server could mark. Adding a logging call would have done nothing.

### 7.2 Two trust failures found while building the above

Both were live, both on registered routes, and neither was on any list:

- **Answer keys travelled with the question.** `correct_index`, the
  explanation, and each option's `reveals` (the misconception tag naming what
  choosing it would say about the learner) were serialised into the check
  block and streamed to the client. The client declined to use them, and said
  so in a comment — but a learner with the network tab open could read the
  answer before choosing. Now stripped at all three exits: the streamed
  lesson, the streamed planner blocks, and the conversation reload.
- **A client could post itself to mastery.** `POST /api/v1/evolution/events`
  accepted `evidence_type`, `evidence_confidence`, `measurable_outcome` and
  `skill_ids_json` straight from the device. A client may now say what it did,
  never what that proved: its events are recorded as exposure with no graded
  outcome. This is also what makes explorable engagement safe to record at
  all.

---

## 8. Phase A — what landed

| Change | Where |
| --- | --- |
| Hard-coded `dailyChallenges` removed from Home | `web/src/app/(main)/page.tsx` |
| `Math.random()` activity calendar and mock achievements removed | `web/src/components/profile/LearningStats.tsx` |
| Empty "Top Topics" chart frame no longer drawn | `web/src/components/profile/LearningStats.tsx` |
| Zero dashboard gated behind real activity | `web/src/app/(main)/page.tsx` (`showLearnerDashboard`) |
| Front door: "What do you want to learn?", Enter Classroom, I have a test | `web/src/components/home/FrontDoor.tsx` |
| Due reviews surfaced on Home, routed into Classroom review mode | `web/src/components/home/NextForYou.tsx` |
| Shared entry contract for opening the Classroom from any surface | `web/src/lib/entry-contract.mjs` |
| Chat accepts a seeded opening turn (`?prompt=`) | `web/src/components/chat/ChatInterface.tsx` |
| Brand converged on LYO across web, iOS and Android | layout metadata, PWA manifest, nav, chat, `Info.plist` |
| Product-trust CI gate | `scripts/verify-product-trust.mjs` |

### Why "I have a test" opens Chat

Test Prep is a real backend intent (`TEST_PREP` in `lyo_app/ai/router.py`),
resolved from what the learner says. The entry therefore says it and lets the
router ask for subject, date and materials. Standing a client-side test-prep
wizard in front of that would be a mock of a flow that already exists.

The full Test Prep product surface — diagnostic, exam readiness, study plan —
is Phase E and needs backend writes this workstream does not have.

### Known follow-ups

- `project.yml` still names the Xcode project `Lyo`. That is the build
  identifier, not the consumer-visible app name (`CFBundleDisplayName` is now
  `LYO`); renaming it moves the `.xcodeproj` and is not worth bundling into a
  product-trust change.
- `Sources/Services/A2A/AgentCardService.swift` reports the organization as
  "Lyo AI". Machine-facing agent-card metadata, left alone deliberately.
- Home still leads with XP and streak for an established learner. Section 22
  wants concepts learned / mastered / retained in that position; that depends
  on the canonical learner model and is Phase B.

---

## 9. Phase B — canonical learner intelligence (client side)

`web/src/lib/learner-model.mjs` is the client's single vocabulary for
evidence, mastery and retention. It is **not** a fifth mastery system: it owns
no state and decides no facts. The server remains authoritative on correctness
and on `mastery_score`; this module gives the four client surfaces one set of
words and one scale to say it in.

### 9.1 The scale bug this closed

Mastery reached the clients under three field names on two scales:

| Field | Surface |
| --- | --- |
| `AnswerCheckResult.mastery` | chat check |
| `SessionSummarySkill.mastery` | session recap |
| `DueReviewItem.mastery_level` | spaced repetition |
| `Flashcard.mastery` | lesson block |

The backend stores 0..1 (`m.mastery_level:.0%`, `< 0.4`, `>= 0.7` in
`lyo_app/predictive` and `lyo_app/services`). `LessonView` rendered
`width: ${card.mastery}%`, so a card at 0.7 mastery drew a 0.7%-wide bar. The
codebase already knew about the ambiguity — `normalizeProgressPercent` in
`learning-progress.ts` handled exactly it — but only in one place. That rule
now lives in `normalizeMastery` / `masteryPercent`, and course progress is the
course-progress name for it.

`normalizeMastery` returns **null**, not 0, for a missing reading. "Never
assessed" and "assessed at zero" are different claims about a learner and the
UI must be able to tell them apart.

### 9.2 Adapting the wire vocabulary

`InputField.evidence_type` in `lyo_app/ai_classroom/sdui_models.py` is
`Literal["explanation", "application", "transfer", "retrieval"]` — narrower
than the product ladder in section 3, and it says "retrieval" where the ladder
says "retention". `normalizeEvidenceKind` adapts wire to ladder rather than
either side being renamed to match the other.

An unrecognised evidence type returns null and advances no rung. A new
server-side type must not be silently scored as `exposure`, and certainly not
as `transfer`.

### 9.3 Rules the module enforces

- `MASTERED` requires application **and** transfer **and** retention, each at
  or above `MASTERY_CONFIDENCE_FLOOR`. Any two is not enough.
- A skipped question (`bailed_out`) yields no evidence at all — not evidence of
  failure.
- Hints damp the confidence attached to a demonstration; they never demote the
  rung, and asking for help is never scored as failure.
- A classroom submission the server did not accept is `exposure`. Submitting is
  not demonstrating.
- An incorrect answer still carries its misconception forward, and a
  misconception survives a later correct retry, so remediation can target it.

### 9.4 Real call sites

The module is on live paths, not parked next to them:

| Call site | What it now uses |
| --- | --- |
| `LessonView` flashcard bar | `masteryPercent` (fixes the 0.7% bar) |
| `learning-progress.ts` | `masteryPercent` behind `normalizeProgressPercent` |
| `NextForYou` | `conceptFromDueReview`, `masteryPercent` |
| `classroom-store.ts` | `transcriptLabelFor`, typed `evidence_type` |

The classroom transcript previously labelled every free-text submission
"Application", including explanation and recall prompts, misreporting the
learner's own record back to them.

### 9.5 Still Phase B, not yet done

Chat, Classroom and Test Prep now share a vocabulary but not yet a single
learner record: each still reads its own endpoint. Collapsing those onto one
client-side learner store needs the backend convergence in section 2.2, which
this workstream cannot write.

---

## 10. Phase C — iOS teaches through one classroom

iOS carried four classroom entry points. Only one was reachable.

| Path | Lines | Routed from | Outcome |
| --- | --- | --- | --- |
| `Views/Main/Classroom/LivingClassroomView.swift` + `Services/LivingClassroomService.swift` | — | `MainTabView`, `EnhancedLyoHomeView`, `DiscoverView` | **CANONICAL** |
| `Services/LivingClassroomEngine.swift` | 589 | nothing | removed |
| `Services/LyoClassroomService.swift` | 143 | nothing | removed |
| `ViewModels/AgenticClassroomViewModel.swift` | 341 | only `AgenticClassroomView` | removed |
| `Views/Main/Classroom/AgenticClassroomView.swift` | 349 | only its own ViewModel | removed |

The Agentic pair referenced only each other — a mutually-referential island
that nothing outside could reach. 1,422 lines total.

Verified before removal, per the deprecation strategy in section 7: every type
each file declared (`LivingClassroomEngine`, `LyoClassroomService`,
`AgenticClassroomViewModel`, `AgenticClassroomView`, `AgentBlockCard`) has zero
references anywhere else in `Sources/` or `Tests/`, and the only non-Swift
references were the generated Xcode build entries. `ClassroomViewModel` is
**LEGACY_ACTIVE** and was deliberately kept: `MainTabView`,
`CourseOrchestrator`, both classroom overlays and `LiveClassroomSmokeTests` all
still use it.

### 10.1 Why the engine had to go, and what it was right about

`LivingClassroomEngine` was an on-device pedagogical loop, added because the
server-pushed classroom could dead-end — its own header says the screen "went
dead" when the backend stopped streaming scenes.

That failure is real and is not fixed by deleting the engine. But fixing it on
the client makes iOS a pedagogically different product from web and Android,
which is exactly what the parity gate exists to prevent. The correct fix is the
server-side safe fallback in section 29 of the specification: when scene
generation fails, teach something safe rather than dead-ending. That remains
open backend work.

### 10.2 Xcode project file

`project.yml` builds the target from the whole `Sources` tree, so
`Lyo.xcodeproj/project.pbxproj` is generated output and CI regenerates it with
`xcodegen generate`. It is also tracked, so the 16 generated entries for the
removed files were deleted from it by UUID to keep a local checkout openable
without regenerating first. No dangling UUID survives.

### 10.3 Verification limit

This workstream has no macOS toolchain, so the iOS target was **not compiled
here**. The removal rests on exhaustive symbol-reference checks rather than a
build. CI's `ios` job (`xcodegen generate` + `xcodebuild test`) is the
authoritative check.

---

## 9. Invariants the parity gate enforces

`scripts/verify-classroom-parity.mjs` is the CI guard that keeps Web, iOS and
Android from becoming pedagogically different products. It already pins shared
voice endpoint, locale flow, learner interruption, offline-safe skip, neutral
skip, hint requests, course identity and contract version.

`scripts/verify-product-trust.mjs` joins it as a second gate, pinning the
Phase A invariants: no fabricated learner stats on Home or the stats panel, a
front door whose CTAs reach real runtime paths, due reviews entering Classroom
review mode without a stored question, and one consumer brand.

Both gates assert against code with comments stripped, so a file may document
the fabricated block it replaced without tripping the gate that documentation
exists to explain.

The product-trust gate also pins the Phase B invariants: mastery requiring all
three strong forms, skipped questions staying neutral, the client never
declaring its own correctness, one mastery scale across renderers, and the
transcript naming the rung actually asked for.
