// ============================================================
// LYO — Shared TypeScript Types (mirrors iOS models)
// ============================================================

// ---- Auth & User ----
export interface User {
  id: string;
  email: string;
  displayName: string;
  username: string;
  avatar: string;
  bio: string;
  role: 'student' | 'creator' | 'mentor' | 'admin';
  interests: string[];
  learningGoals: string[];
  streak: number;
  xp: number;
  level: number;
  coursesCompleted: number;
  followersCount: number;
  followingCount: number;
  createdAt: string;
  isPremium: boolean;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// ---- Chat / LYO AI ----
export interface ChatAttachment {
  name: string;
  url: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'document';
}

/**
 * Structured content blocks streamed with an assistant turn.
 *
 * Mirrors the backend's SmartBlock envelope (lyo_app/ai/schemas/smart_block.py)
 * and iOS's Sources/Models/SmartBlock.swift. `unknown` is the deliberate
 * forward-compatibility escape hatch: a block type this client does not know
 * yet must be skipped, never rendered as raw JSON and never thrown on.
 */
export type ChatBlockType =
  | 'text'
  | 'code'
  | 'quiz'
  | 'flashcard'
  | 'dataViz'
  | 'media'
  | 'progress'
  | 'interactive'
  | 'masteryMap'
  | 'unknown';

export interface ChatBlock {
  id: string;
  schema_version?: number;
  type: ChatBlockType;
  /** Beat within a lesson: hook | core | representation | example | method | callout | table | mcq */
  subtype?: string | null;
  content: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

/**
 * Narrowed content shape for `type: 'quiz'` blocks — the gradeable check.
 *
 * `correct_index`, `explanation` and each option's `reveals` are **stripped by
 * the server** before a block reaches any client. They used to arrive with the
 * question, which meant the answer key and the internal misconception tags
 * were readable in the network tab before the learner chose anything.
 *
 * They stay in the type as optional because stored blocks written before the
 * redaction landed may still carry them, and because the same shape describes
 * the server-side block. Nothing in the UI may read them: the verdict comes
 * from `CheckAnswerResult` after submission.
 */
export interface ChatQuizContent {
  question: string;
  options: { id: string; text: string; reveals?: string | null }[];
  /** Redacted on the wire. Never used to decide correctness on the client. */
  correct_index?: number;
  /** Redacted on the wire. The post-answer explanation arrives on the result. */
  explanation?: string | null;
  /** Kept: the learner is meant to be able to ask, and asking is tracked. */
  hint?: string | null;
  /** Kept: the "just explain it" opt-out has to be visible to be chosen. */
  bailout_index?: number | null;
}

/** Server verdict for an answered check. The client renders this, never computes it. */
export interface CheckAnswerResult {
  correct: boolean;
  correct_index: number;
  /** Echoed back so the chosen option can be highlighted after a reload. */
  selected_index: number;
  explanation?: string | null;
  misconception?: string | null;
  bailed_out: boolean;
  skill_id?: string | null;
  mastery?: number | null;
  next_actions?: string[];
}

/** A skill touched by an answered check, as summarized at session close. */
export interface SessionSummarySkill {
  skill_id: string;
  mastery?: number | null;
  question?: string | null;
  misconception?: string | null;
}

/** Recap of a conversation's answered checks: what landed vs. what's shaky. */
export interface SessionSummary {
  conversation_id: string;
  total_checks: number;
  correct_checks: number;
  nailed: SessionSummarySkill[];
  shaky: SessionSummarySkill[];
}

/** A skill whose spaced-repetition schedule says it's due for another look. */
export interface DueReviewItem {
  skill_id: string;
  days_overdue: number;
  mastery_level?: number | null;
  last_misconception?: string | null;
}

/**
 * How many concepts the learner is exploring, has learned, retained and
 * mastered. Counted server-side from their own evidence — see
 * `lyo_app/events/concept_summary.py` for what each word is earned by.
 *
 * The categories are a funnel, not a partition: a mastered concept is also
 * learned and retained. Summing them would double-count.
 */
export interface ConceptSummary {
  exploring: number;
  learned: number;
  retained: number;
  mastered: number;
  total: number;
}

/**
 * One concrete next thing to do, and why it was chosen.
 *
 * The reason is assembled server-side so every client says the same thing
 * about the same learner — and so a learner can disagree with it, which is
 * what makes a recommendation honest rather than oracular.
 */
export interface Recommendation {
  concept_id: string;
  reason: 'due_for_review' | 'needs_practice';
  detail: string;
  /** 0..1, or null when never assessed. Null and zero are different claims. */
  mastery?: number | null;
  days_overdue: number;
}

export interface RecommendationList {
  items: Recommendation[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type: 'text' | 'course_proposal' | 'flashcard' | 'quiz' | 'diagram' | 'roadmap' | 'topic_selection';
  /** Structured lesson blocks, when the turn carried them. */
  blocks?: ChatBlock[];
  /** Server-graded results, keyed by check block id. */
  checkResults?: Record<string, CheckAnswerResult>;
  /** Server-suggested follow-up directions for this turn. */
  suggestedActions?: string[];
  metadata?: Record<string, unknown>;
  attachments?: ChatAttachment[];
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  courseId?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Courses ----
export interface Course {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  author: User;
  category: string;
  tags: string[];
  modules: CourseModule[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  language?: string;
  estimatedDuration: number; // minutes
  enrolledCount: number;
  rating: number;
  reviewCount: number;
  progress?: number; // 0-100
  isAIGenerated: boolean;
  createdAt: string;
}

export interface CourseModule {
  id: string;
  title: string;
  description: string;
  order: number;
  lessons: Lesson[];
  isCompleted?: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  type: 'text' | 'video' | 'quiz' | 'exercise' | 'flashcard' | 'interactive';
  content: LessonBlock[];
  duration: number;
  order: number;
  isCompleted?: boolean;
}

export interface LessonBlock {
  id: string;
  type: 'text' | 'heading' | 'code' | 'image' | 'video' | 'quiz' | 'flashcard' | 'diagram' | 'analogy' | 'summary' | 'exercise';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface Quiz {
  id: string;
  title: string;
  questions: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'true_false' | 'fill_blank' | 'code';
  options?: string[];
  correctAnswer: string | number;
  explanation: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  category: string;
  mastery: number;
}

// ---- Clips (TikTok-style videos) ----
export interface Clip {
  id: string;
  author: User;
  videoUrl: string;
  thumbnailUrl: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  duration: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  isLiked?: boolean;
  isBookmarked?: boolean;
  courseId?: string;
  createdAt: string;
}

export interface ClipComment {
  id: string;
  author: User;
  content: string;
  likes: number;
  isLiked?: boolean;
  createdAt: string;
  replies?: ClipComment[];
}

// ---- Stories ----
export interface Story {
  id: string;
  author: User;
  slides: StorySlide[];
  viewCount: number;
  isViewed?: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface StorySlide {
  id: string;
  type: 'image' | 'video' | 'course_completion' | 'achievement' | 'text';
  mediaUrl?: string;
  text?: string;
  backgroundColor?: string;
  courseId?: string;
  achievementId?: string;
  duration: number;
}

// ---- Community ----
export interface CommunityPost {
  id: string;
  author: User;
  type: 'post' | 'question' | 'study_tip' | 'event' | 'poll' | 'course_share' | 'achievement';
  title: string;
  content: string;
  images?: string[];
  tags: string[];
  category: string;
  likes: number;
  comments: number;
  views: number;
  isLiked?: boolean;
  isBookmarked?: boolean;
  isPinned?: boolean;
  courseId?: string;
  poll?: Poll;
  createdAt: string;
}

export interface Poll {
  id: string;
  options: PollOption[];
  totalVotes: number;
  endsAt: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  isSelected?: boolean;
}

export interface Comment {
  id: string;
  author: User;
  content: string;
  likes: number;
  isLiked?: boolean;
  createdAt: string;
  replies?: Comment[];
}

export interface Group {
  id: string;
  name: string;
  description: string;
  coverImage: string;
  icon: string;
  memberCount: number;
  category: string;
  isJoined?: boolean;
  isPrivate: boolean;
  admin: User;
  recentActivity: string;
  createdAt: string;
}

// ---- Discovery ----
export interface EducationalPlace {
  id: string;
  name: string;
  type: 'school' | 'library' | 'workshop' | 'lab' | 'community_center' | 'online';
  description: string;
  address: string;
  coordinates: { lat: number; lng: number };
  rating: number;
  reviewCount: number;
  images: string[];
  categories: string[];
  distance?: number;
  isOpen?: boolean;
  website?: string;
  phone?: string;
}

export interface EducationalEvent {
  id: string;
  title: string;
  description: string;
  host: User | EducationalPlace;
  type: 'class' | 'workshop' | 'meetup' | 'webinar' | 'study_group';
  category: string;
  startDate: string;
  endDate: string;
  location: string;
  isVirtual: boolean;
  meetingUrl?: string;
  maxAttendees: number;
  currentAttendees: number;
  price: number;
  isRegistered?: boolean;
  coverImage: string;
}

export type LearningNodeKind = 'event' | 'study_group' | 'private_lesson' | 'institution';

export type LearningNodeCategory =
  | 'event'
  | 'workshop'
  | 'class'
  | 'study_group'
  | 'tutor'
  | 'library'
  | 'museum'
  | 'educational_center';

export interface CommunityUserPreview {
  id: number;
  name: string;
  avatar?: string | null;
}

/** Canonical map node returned by /community/nearby on every platform. */
export interface LearningNode {
  key: string;
  kind: LearningNodeKind;
  category: LearningNodeCategory;
  id: string;
  title: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  location_name?: string | null;
  is_online: boolean;
  meeting_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  host?: CommunityUserPreview | null;
  member_count?: number | null;
  attendee_count?: number | null;
  capacity?: number | null;
  is_joined: boolean;
  is_attending: boolean;
  is_saved: boolean;
  course_id?: number | null;
  lesson_id?: number | null;
  study_group_id?: number | null;
  image_url?: string | null;
  source: string;
  source_url?: string | null;
}

export interface NearbyLearningResponse {
  items: LearningNode[];
  center_latitude: number;
  center_longitude: number;
  radius_km: number;
  fetched_at: string;
}

export interface MyCommunityResponse {
  joined_groups: Record<string, unknown>[];
  attending_events: Record<string, unknown>[];
  saved_nodes: LearningNode[];
  following: CommunityUserPreview[];
  updated_at: string;
}

// ---- Gamification ----
export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'learning' | 'social' | 'creation' | 'streak' | 'mastery';
  xpReward: number;
  isUnlocked: boolean;
  unlockedAt?: string;
  progress?: number;
  requirement: number;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly' | 'special';
  xpReward: number;
  progress: number;
  requirement: number;
  isCompleted: boolean;
  expiresAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  user: User;
  xp: number;
  streak: number;
}

// ---- Notifications ----
export interface AppNotification {
  id: string;
  type: 'like' | 'comment' | 'follow' | 'course_complete' | 'achievement' | 'mention' | 'group_invite' | 'event_reminder' | 'system';
  title: string;
  body: string;
  actor?: User;
  targetId?: string;
  targetType?: string;
  isRead: boolean;
  createdAt: string;
}

// ---- Messages ----
export interface Conversation {
  id: string;
  participants: User[];
  lastMessage: DirectMessage;
  unreadCount: number;
  updatedAt: string;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'course_share' | 'clip_share';
  mediaUrl?: string;
  isRead: boolean;
  createdAt: string;
}

// ---- Community Stats ----
export interface CommunityStats {
  totalMembers: number;
  activeToday: number;
  totalPosts: number;
  totalCourses: number;
  totalClips: number;
}

// ---- Learning Stats ----
export interface LearningStats {
  totalHoursLearned: number;
  coursesCompleted: number;
  coursesInProgress: number;
  quizzesPassed: number;
  currentStreak: number;
  longestStreak: number;
  xpThisWeek: number;
  topTopics: { topic: string; hours: number }[];
}

// ---- API Response ----
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ---- Course Generation ----
export interface CourseGenerationRequest {
  query: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  duration?: 'short' | 'medium' | 'long';
  style?: 'visual' | 'reading' | 'interactive' | 'mixed';
}

export interface CourseGenerationEvent {
  type: 'thinking' | 'outline' | 'module' | 'lesson' | 'quiz' | 'complete' | 'error';
  data: unknown;
  progress: number;
}

// ── Test prep ──
//
// The wire shapes behind /api/v1/me/study_plans. `mastery` and `readiness`
// are nullable on purpose: null means never assessed, which is a different
// claim from 0 and must not be rendered as the same number. Read them through
// web/src/lib/test-prep.mjs rather than formatting them at the call site.

export interface StudyPlanSummary {
  id: string;
  status?: string | undefined;
  created_at?: string | undefined;
  test_profile_id?: string | undefined;
  total_sessions?: number | undefined;
}

export interface TopicStandingRow {
  topic: string;
  concept_id: string;
  weight: number;
  /** null means never assessed — a different claim from 0. */
  mastery: number | null;
  attempts: number;
}

export interface ReadinessPayload {
  plan_id: string;
  subject: string;
  test_date: string;
  days_remaining: number | null;
  readiness: number | null;
  topics_total: number;
  topics_assessed: number;
  topics: TopicStandingRow[];
  focus_next: string[];
}

export interface StudySessionRow {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  topic: string;
  session_type: string;
  concept_id: string;
  status: string;
  performance_score: number | null;
}

export interface IntakeTurn {
  test_profile_id: string;
  message_to_user: string;
  smart_blocks: unknown[];
  intake_complete: boolean;
}

/**
 * What the server measured for a completed session.
 *
 * `performance_score` is null when nothing was graded — a session spent
 * reading is a real session, and the server refuses to invent a figure for
 * it. Null is not zero here; read it through `completionSummary`.
 */
export interface SessionOutcomeReply {
  ok: boolean;
  performance_score: number | null;
  graded: number;
  seen: number;
}

/** The Test Prep page's state. See web/src/lib/test-prep-state.mjs. */
export interface TestPrepState {
  stage: 'intake' | 'plan';
  loading: boolean;
  loadedOnce: boolean;
  planId: string | null;
  readiness: ReadinessPayload | null;
  sessions: StudySessionRow[];
  sessionsFailed: boolean;
  refreshFailed: boolean;
  planLoadFailed: boolean;
  notice: string | null;
  finishing: string | null;
}

export type TestPrepAction =
  | { type: 'load_started' }
  | { type: 'plan_loaded'; planId: string }
  | { type: 'no_plan' }
  | {
      type: 'details_loaded';
      /** Omitted when the call failed — distinct from a null payload. */
      readiness?: ReadinessPayload | undefined;
      sessions?: StudySessionRow[] | undefined;
    }
  | { type: 'load_failed' }
  | { type: 'load_settled' }
  | { type: 'finish_started'; sessionId: string }
  | { type: 'finish_succeeded'; sessionId: string; notice: string }
  | { type: 'finish_failed'; notice: string };
