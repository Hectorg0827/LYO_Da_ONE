'use client';

import { create } from 'zustand';
import { playSound, type AmbientSound } from '@/lib/classroom-sounds';
import { buildClassroomWsUrl } from '@/lib/classroom-contract.mjs';
import { updateCourseProgress } from '@/lib/stack';
import { transcriptLabelFor } from '@/lib/learner-model.mjs';
import type {
  ClassroomContractConnection,
  ClassroomMode,
  HintLevel,
} from '@/lib/classroom-contract.mjs';

export type { ClassroomMode, HintLevel };

// ─── Wire types (match backend lyo_app/ai_classroom exactly) ─────────────────

export interface QuizOption {
  id: string;
  label: string;
  is_correct?: boolean;
  feedback_correct?: string | null;
  feedback_incorrect?: string | null;
  misconception_tag?: string | null;
  remediation_hint?: string | null;
}

/** The four values lyo_app/ai_classroom/sdui_models.py puts on the wire. */
type EvidenceWireType = 'explanation' | 'application' | 'transfer' | 'retrieval';

export interface ClassroomComponent {
  component_id: string;
  type: string;
  text?: string;
  label?: string;
  student_name?: string;
  question?: string;
  options?: QuizOption[];
  action_intent?: string;
  concept_id?: string | null;
  current?: number;
  total?: number;
  placeholder?: string;
  expected_keywords?: string[];
  min_words?: number;
  max_words?: number;
  min_score?: number;
  /** What the component is asking the learner to demonstrate. The wire
   *  vocabulary is narrower than the product ladder and calls retention
   *  "retrieval" — normalizeEvidenceKind adapts it. */
  evidence_type?: EvidenceWireType;
  source_attributions?: string[];
  language_code?: string;
  audio_url?: string | null;
  title?: string;
  content?: string;
  block_type?: string;
  block?: {
    title?: string;
    content?: string;
    items?: string[];
    source_attributions?: string[];
    retrieval_scheduled?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** One director turn inside a TeacherMessage's JSON script. */
export interface DirectorTurn {
  type: 'speech' | 'user_prompt' | 'lyo_state' | 'board' | 'ambient' | 'pause' | 'session_end';
  speaker?: string;
  text?: string;
  input?: 'voice' | 'tap';
  options?: string[];
  beat_seconds?: number;
  state?: string;
  action?: 'write' | 'draw' | 'highlight' | 'image' | 'bullets' | 'chart' | 'explorable';
  content?: string;
  seconds?: number;
  sound?: string;
  homework?: string;
  next_hook?: string;
  lyo_state?: string;
  // Phase 2 vocabulary
  query?: string;                       // image search query
  caption?: string;                     // image caption
  items?: string[];                     // bullets
  chart_type?: 'bar' | 'line';
  labels?: string[];
  values?: number[];
  expression?: string;                  // explorable
  params?: { name: string; min: number; max: number; initial: number; step?: number }[];
  x_min?: number;
  x_max?: number;
  prompt?: string;
}

// ─── Board model — the main attraction ───────────────────────────────────────

export type BoardElement =
  | { id: string; kind: 'chalk'; text: string; highlightedTerm?: string }
  | { id: string; kind: 'highlight'; term: string }
  | { id: string; kind: 'latex'; latex: string }
  | { id: string; kind: 'mermaid'; source: string }
  | { id: string; kind: 'code'; code: string }
  | { id: string; kind: 'image'; url: string | null; caption?: string; query: string; attribution?: string; sourceUrl?: string }
  | { id: string; kind: 'bullets'; items: string[] }
  | { id: string; kind: 'chart'; chartType: 'bar' | 'line'; labels: string[]; values: number[] }
  | { id: string; kind: 'explorable'; expression: string; params: { name: string; min: number; max: number; initial: number; step?: number }[]; xMin?: number; xMax?: number; prompt?: string }
  | { id: string; kind: 'quiz'; quiz: ClassroomComponent; answered?: string; wasCorrect?: boolean; feedback?: string; skipped?: boolean }
  | { id: string; kind: 'transfer'; input: ClassroomComponent; response?: string; submitted?: boolean; skipped?: boolean }
  | { id: string; kind: 'summary'; title: string; content?: string; items: string[]; retrievalScheduled?: boolean }
  | { id: string; kind: 'source'; labels: string[] }
  | { id: string; kind: 'dismissal'; homework?: string; nextHook?: string };

export interface TranscriptItem {
  id: string;
  speaker: string;
  text: string;
}

export interface ActivePrompt {
  id: string;
  speaker: string;
  text: string;
  /** Only set when the question is genuinely multiple-choice — real,
      question-specific options from the director script. Absent for
      open-ended questions ("what do you think...", "give me an
      example..."), which expect a typed/spoken answer instead. Never
      defaulted to a generic yes/no pair. */
  options?: string[];
}

export interface Caption {
  speaker: string;
  text: string;
}

type Status = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface ClassroomConnection extends ClassroomContractConnection {
  mode?: ClassroomMode;
  courseId?: string;
  lessonId?: string;
}

interface ClassroomStore {
  status: Status;
  topic: string;
  sessionId: string;
  objective: string;
  languageCode: string;

  board: BoardElement[];        // the live board
  boardHistory: BoardElement[][]; // erased boards (flip back through)
  viewingBoard: number;         // -1 = live, else history index

  caption: Caption | null;      // the line being spoken right now
  activeSpeaker: string | null; // who is talking (lights up in the cast row)
  prompt: ActivePrompt | null;  // cold-call awaiting the learner
  transcript: TranscriptItem[]; // full log — the drawer, the byproduct

  lyoState: string;
  waitingForScene: boolean;
  // True whenever the auto-paced narration (speech/board/pause turns) is
  // actively playing — i.e. there's something skipTurn() could cut short.
  // False while idle, while a user_prompt/quiz/transfer is waiting on the
  // learner, and while paused. Drives whether the "Skip" control is live.
  isNarrating: boolean;
  canContinue: boolean;
  progressCurrent: number;
  progressTotal: number;
  continueLabel: string;
  nextActionIntent: string;
  error: string | null;

  soundOn: boolean;
  voiceOn: boolean;
  speechRate: number;
  isPaused: boolean;        // the single most accessible control: stop the class

  connect: (connection: ClassroomConnection) => void;
  disconnect: () => void;
  answerPrompt: (option: string) => void;
  answerQuiz: (elementId: string, option: QuizOption) => void;
  answerTransfer: (elementId: string, response: string) => void;
  skipQuestion: (elementId: string) => void;
  unskipQuestion: (elementId: string) => void;
  askQuestion: (text: string) => void;
  takeFloor: () => void;
  signal: (kind: 'confused' | 'too_easy') => void;
  requestHint: (level: HintLevel) => void;
  continueLesson: () => void;
  /** Cuts the currently-playing narration turn short and immediately
      advances to the next queued one — a video-style "skip ahead" for the
      teacher's auto-paced speech/board/pause turns. A no-op when there's
      nothing playing (waiting on the server, a prompt/quiz needs an
      answer, or the class is paused) — see isNarrating. */
  skipTurn: () => void;
  toggleSound: () => void;
  toggleVoice: () => void;
  togglePause: () => void;
  setSpeechRate: (rate: number) => void;
  viewBoard: (index: number) => void; // -1 = live
}

// ─── Internals ───────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let turnQueue: DirectorTurn[] = [];
let playing = false;
let playTimer: ReturnType<typeof setTimeout> | null = null;
let speechAbort: AbortController | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let speechGeneration = 0;
let authToken: string | null = null;
let idCounter = 0;
let pendingErase = false; // erase lazily when the NEW scene's content arrives
const nextId = () => `cf_${++idCounter}`;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.lyoai.app';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

function wsUrl(connection: ClassroomConnection, token: string | null): string {
  return buildClassroomWsUrl(API_URL, connection, token);
}

/** Exported so the caption UI can pace its word-by-word reveal against the
    same estimate the player itself uses for text-only/fallback pacing —
    one formula, not two that can drift apart. */
export function speechDelay(text: string): number {
  return Math.min(Math.max(text.length * 34, 1400), 7000);
}

function stopSpeech() {
  speechGeneration += 1;
  speechAbort?.abort();
  speechAbort = null;
  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// Non-Latin scripts are decisive, but only in this order: Japanese prose mixes
// kana with kanji, and Korean can carry hanja, so those language-specific
// scripts must be checked before the CJK ideographs they share with Chinese.
const SCRIPT_LANGUAGE_HINTS: { code: string; test: RegExp }[] = [
  { code: 'ja', test: /[぀-ヿ]/ },   // hiragana + katakana
  { code: 'ko', test: /[가-힯]/ },   // hangul syllables
  { code: 'ar', test: /[؀-ۿ]/ },
  { code: 'ru', test: /[Ѐ-ӿ]/ },
  { code: 'hi', test: /[ऀ-ॿ]/ },
  { code: 'zh', test: /[一-鿿]/ },   // shared ideographs — last resort
];

// Latin-script languages share an alphabet and much of their function-word
// vocabulary ("la" is French and Spanish, "para" is Spanish and Portuguese),
// so no single hint is decisive. Score every candidate across the whole sample
// and take the strongest rather than returning on the first pattern that hits.
const LATIN_LANGUAGE_HINTS: { code: string; unique?: RegExp; words: RegExp }[] = [
  { code: 'es', unique: /[¿¡ñ]/g, words: /\b(el|los|las|que|para|con|una|uno|por|cómo|qué|cuál|más|así|pero|también|está)\b/gi },
  { code: 'pt', unique: /[ãõ]/g, words: /\b(não|com|para|uma|isso|então|você|está|são|também|mais)\b/gi },
  { code: 'fr', unique: /[œùêîôë]/g, words: /\b(le|la|les|des|est|une|avec|pour|qui|où|dans|nous|être|cette)\b/gi },
  { code: 'de', unique: /[äöüß]/g, words: /\b(der|die|das|und|nicht|mit|für|eine|ist|auch|sich|wird)\b/gi },
  { code: 'it', words: /\b(il|lo|gli|che|per|con|una|è|questo|come|sono|anche|della)\b/gi },
];

// A language-exclusive character is far stronger evidence than a function word
// that several languages share.
const UNIQUE_CHAR_WEIGHT = 3;
// Below this, the evidence is as likely to be an English coincidence as a real
// signal — fall back to the browser's default voice instead of guessing.
const MIN_LANGUAGE_SCORE = 2;

function scoreLatinLanguage(text: string, hint: { unique?: RegExp; words: RegExp }): number {
  const uniqueHits = hint.unique ? (text.match(hint.unique)?.length ?? 0) : 0;
  const distinctWords = new Set(
    (text.match(hint.words) ?? []).map((word) => word.toLowerCase()),
  ).size;
  return uniqueHits * UNIQUE_CHAR_WEIGHT + distinctWords;
}

/**
 * Best-effort guess at the spoken-language code for `text`, so narration is
 * read in a matching voice instead of always defaulting to English. Returns
 * null (meaning: let the browser's default voice handle it) when the text is
 * too short or shows no language-specific signal.
 */
function detectSpeechLanguage(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 8) return null;

  for (const { code, test } of SCRIPT_LANGUAGE_HINTS) {
    if (test.test(trimmed)) return code;
  }

  let best: { code: string; score: number } | null = null;
  for (const hint of LATIN_LANGUAGE_HINTS) {
    const score = scoreLatinLanguage(trimmed, hint);
    if (score > (best?.score ?? 0)) best = { code: hint.code, score };
  }
  return best && best.score >= MIN_LANGUAGE_SCORE ? best.code : null;
}

/** Picks an installed SpeechSynthesis voice matching a language code, if any. */
function findVoiceForLanguage(code: string): SpeechSynthesisVoice | undefined {
  return window.speechSynthesis.getVoices()
    .find((voice) => voice.lang.toLowerCase().startsWith(code));
}

/** Classify a board "write"/"draw" payload into the right visual. */
function classifyBoardContent(content: string): BoardElement {
  const id = nextId();
  const trimmed = content.trim();
  const firstLine = trimmed.split('\n')[0].trim().toLowerCase();

  if (/^(graph|flowchart|sequencediagram|classdiagram|statediagram|erdiagram|pie|mindmap|timeline|journey)\b/.test(firstLine)) {
    return { id, kind: 'mermaid', source: trimmed };
  }
  if (/\\(frac|sum|int|theta|alpha|beta|sqrt|cdot|times|pi|infty|approx|le|ge|neq)|\^\{|_\{/.test(trimmed)) {
    return { id, kind: 'latex', latex: trimmed };
  }
  const codeSignals = /(def |function |=> |const |let |var |class |import |return |print\(|console\.|#include|public |;\s*$)/m;
  if (trimmed.includes('\n') && codeSignals.test(trimmed)) {
    return { id, kind: 'code', code: trimmed };
  }
  return { id, kind: 'chalk', text: trimmed };
}

/** Resolve an image query via Wikimedia Commons (free, keyless, CORS-open). */
async function resolveImage(query: string): Promise<{
  url: string;
  attribution: string;
  sourceUrl?: string;
} | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `filetype:bitmap ${query}`,
      gsrlimit: '1',
      gsrnamespace: '6',
      prop: 'imageinfo|info',
      inprop: 'url',
      iiprop: 'url|extmetadata',
      iiurlwidth: '760',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const first = Object.values(pages)[0] as {
      title?: string;
      canonicalurl?: string;
      imageinfo?: { thumburl?: string; url?: string }[];
    };
    const info = first?.imageinfo?.[0];
    const url = info?.thumburl || info?.url;
    return url ? {
      url,
      attribution: first.title || 'Wikimedia Commons',
      sourceUrl: first.canonicalurl,
    } : null;
  } catch {
    return null;
  }
}

export const useClassroomStore = create<ClassroomStore>((set, get) => {
  // ── helpers ──

  const sfx = (sound: AmbientSound) => { if (get().soundOn) playSound(sound); };

  function speakWithLocalizedDeviceVoice(
    text: string,
    language: string,
    generation: number,
    onDone: () => void,
  ) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      playTimer = setTimeout(onDone, speechDelay(text));
      return;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      const detectedLanguage = detectSpeechLanguage(text);
      const resolvedLanguage = language === 'auto'
        ? (detectedLanguage || window.navigator.language || 'en-US')
        : language;
      utterance.lang = resolvedLanguage;
      const family = resolvedLanguage.split('-')[0].toLowerCase();
      utterance.voice = findVoiceForLanguage(family) ?? null;
      utterance.pitch = 1;
      utterance.rate = get().speechRate;
      let finished = false;
      const done = () => {
        if (!finished && generation === speechGeneration) {
          finished = true;
          onDone();
        }
      };
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
      playTimer = setTimeout(done, Math.max(speechDelay(text) * 1.8, 9000));
    } catch {
      playTimer = setTimeout(onDone, speechDelay(text));
    }
  }

  function speakLine(_speaker: string, text: string, onDone: () => void) {
    if (!get().voiceOn || typeof window === 'undefined') {
      playTimer = setTimeout(onDone, speechDelay(text));
      return;
    }

    const generation = ++speechGeneration;
    const controller = new AbortController();
    speechAbort = controller;
    const language = get().languageCode || 'auto';

    void (async () => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        if (API_KEY) headers['X-API-Key'] = API_KEY;
        const response = await fetch(
          `${API_URL.replace(/\/$/, '')}/api/v1/tts/synthesize/stream`,
          {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              text,
              voice: 'nova',
              format: 'mp3',
              speed: get().speechRate,
              content_type: 'explanation',
              language,
            }),
          },
        );
        if (!response.ok) throw new Error(`Shared voice returned ${response.status}`);
        const audioBlob = await response.blob();
        if (generation !== speechGeneration) return;

        activeAudioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(activeAudioUrl);
        activeAudio = audio;
        let finished = false;
        const cleanup = () => {
          if (activeAudio === audio) activeAudio = null;
          if (activeAudioUrl) {
            URL.revokeObjectURL(activeAudioUrl);
            activeAudioUrl = null;
          }
        };
        const done = () => {
          if (finished) return;
          finished = true;
          cleanup();
          if (generation === speechGeneration) onDone();
        };
        audio.onended = done;
        audio.onerror = done;
        await audio.play();
      } catch {
        if (controller.signal.aborted || generation !== speechGeneration) return;
        if (activeAudio) {
          activeAudio.onended = null;
          activeAudio.onerror = null;
          activeAudio.pause();
          activeAudio = null;
        }
        if (activeAudioUrl) {
          URL.revokeObjectURL(activeAudioUrl);
          activeAudioUrl = null;
        }
        // Emergency fallback only: choose a device voice in the correct locale.
        // The shared neural voice remains the normal cross-platform path.
        speakWithLocalizedDeviceVoice(text, language, generation, onDone);
      } finally {
        if (speechAbort === controller) speechAbort = null;
      }
    })();
  }

  function pushTranscript(speaker: string, text: string) {
    set((s) => ({ transcript: [...s.transcript, { id: nextId(), speaker, text }] }));
  }

  /** The teacher erases the board only when the next scene's content is
      actually ready — not the moment generation starts, which left learners
      staring at an empty board for the whole LLM round-trip. */
  function maybeEraseForNewScene() {
    if (!pendingErase) return;
    pendingErase = false;
    eraseBoard();
  }

  function addBoardElement(el: BoardElement) {
    maybeEraseForNewScene();
    sfx('chalk');
    set((s) => ({ board: [...s.board, el], viewingBoard: -1, waitingForScene: false }));
  }

  /** Wire the current spoken emphasis onto the board: mark the term inline
      in the most recent chalk block if it appears there — e.g. highlighting
      "3x" while the Teacher explains the coefficient — and always drop a
      circled "spotlight" element too, so highlighting still shows up even
      when the term lives inside a diagram/LaTeX block instead of plain
      chalk text. */
  function highlightBoardTerm(term: string) {
    set((s) => {
      const board = [...s.board];
      const lastChalkIndex = board.map((b) => b.kind).lastIndexOf('chalk');
      if (lastChalkIndex !== -1) {
        const el = board[lastChalkIndex];
        if (el.kind === 'chalk' && el.text.toLowerCase().includes(term.toLowerCase())) {
          board[lastChalkIndex] = { ...el, highlightedTerm: term };
        }
      }
      return { board };
    });
    // Auto-clear the inline mark after a few seconds — it reflects what's
    // being discussed right now, not a permanent decoration. A plain timer,
    // not `playTimer`, which drives turn sequencing and must not be
    // hijacked by an unrelated cleanup callback.
    setTimeout(() => {
      set((s) => ({
        board: s.board.map((b) => (
          b.kind === 'chalk' && b.highlightedTerm === term ? { ...b, highlightedTerm: undefined } : b
        )),
      }));
    }, 5000);
    addBoardElement({ id: nextId(), kind: 'highlight', term });
  }

  function addSources(labels?: string[]) {
    const clean = Array.from(
      new Set((labels ?? []).map((label) => label.trim()).filter(Boolean)),
    );
    if (!clean.length) return;
    const alreadyShown = get().board.some(
      (el) => el.kind === 'source' && clean.every((label) => el.labels.includes(label)),
    );
    if (!alreadyShown) addBoardElement({ id: nextId(), kind: 'source', labels: clean });
  }

  function eraseBoard() {
    const { board } = get();
    if (board.length === 0) return;
    set((s) => ({
      boardHistory: [...s.boardHistory, s.board],
      board: [],
      viewingBoard: -1,
    }));
  }

  // ── turn player ──

  function stopPlayer() {
    playing = false;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    stopSpeech();
    set({ isNarrating: false });
  }

  function learnerTakesFloor() {
    stopPlayer();
    turnQueue = [];
    set({ caption: null, activeSpeaker: null, prompt: null });
  }

  function playNext() {
    if (!playing || get().isPaused) return;
    const turn = turnQueue.shift();
    if (!turn) {
      playing = false;
      set({ activeSpeaker: null, isNarrating: false });
      return;
    }

    switch (turn.type) {
      case 'speech': {
        const text = (turn.text ?? '').trim();
        if (text) {
          const speaker = turn.speaker || 'Teacher';
          set({ caption: { speaker, text }, activeSpeaker: speaker });
          pushTranscript(speaker, text);
          speakLine(speaker, text, playNext);
          return;
        }
        break;
      }

      case 'user_prompt': {
        const text = (turn.text ?? '').trim();
        const speaker = turn.speaker || 'Teacher';
        const promptId = nextId();
        // Never default to a generic yes/no pair — that's the exact bug
        // that made "can you give me an example?" show Yes/No buttons.
        // Only set `options` when the director actually sent real,
        // question-specific ones; otherwise the UI renders an open text
        // input instead.
        set({
          caption: { speaker, text },
          activeSpeaker: speaker,
          prompt: {
            id: promptId, speaker, text,
            options: turn.options?.length ? turn.options : undefined,
          },
        });
        pushTranscript(speaker, `${text} (asks you)`);
        if (get().voiceOn) speakLine(speaker, text, () => undefined);
        playing = false;
        set({ isNarrating: false });
        // The learner owns this turn. There is intentionally no timer and no
        // AI classmate response while the real learner is silent.
        return;
      }

      case 'lyo_state':
        if (turn.state) set({ lyoState: turn.state });
        break;

      case 'board': {
        const action = turn.action ?? 'write';
        if (action === 'image' && (turn.query || turn.content)) {
          const query = (turn.query || turn.content || '').trim();
          const el: BoardElement = { id: nextId(), kind: 'image', url: null, caption: turn.caption, query };
          addBoardElement(el);
          void resolveImage(query).then((img) => {
            set((s) => ({
              board: img
                ? s.board.map((b) => (
                    b.id === el.id
                      ? { ...b, url: img.url, attribution: img.attribution, sourceUrl: img.sourceUrl }
                      : b
                  ))
                : s.board.filter((b) => b.id !== el.id), // nothing found — erase quietly
            }));
          });
          playTimer = setTimeout(playNext, 1800);
          return;
        }
        if (action === 'bullets' && turn.items?.length) {
          addBoardElement({ id: nextId(), kind: 'bullets', items: turn.items });
          playTimer = setTimeout(playNext, Math.min(turn.items.length * 700 + 800, 4200));
          return;
        }
        if (action === 'chart' && turn.labels?.length && turn.values?.length) {
          addBoardElement({
            id: nextId(), kind: 'chart',
            chartType: turn.chart_type === 'line' ? 'line' : 'bar',
            labels: turn.labels, values: turn.values,
          });
          playTimer = setTimeout(playNext, 2400);
          return;
        }
        if (action === 'explorable' && turn.expression && turn.params?.length) {
          addBoardElement({
            id: nextId(), kind: 'explorable',
            expression: turn.expression, params: turn.params,
            xMin: turn.x_min, xMax: turn.x_max, prompt: turn.prompt,
          });
          playTimer = setTimeout(playNext, 2000);
          return;
        }
        if (action === 'highlight') {
          const term = (turn.content ?? '').trim();
          if (term) {
            highlightBoardTerm(term);
            playTimer = setTimeout(playNext, 1600);
            return;
          }
        }
        const content = (turn.content ?? '').trim();
        if (content) {
          addBoardElement(classifyBoardContent(content));
          playTimer = setTimeout(playNext, 2400);
          return;
        }
        break;
      }

      case 'ambient': {
        const sound = (turn.sound || turn.content || '') as AmbientSound;
        if (['bell', 'page_turn', 'chair_scrape', 'soft_laugh'].includes(sound)) sfx(sound);
        break;
      }

      case 'pause':
        playTimer = setTimeout(playNext, Math.min(turn.seconds ?? 1, 5) * 1000);
        return;

      case 'session_end':
        sfx('bell');
        addBoardElement({ id: nextId(), kind: 'dismissal', homework: turn.homework, nextHook: turn.next_hook });
        pushTranscript('Teacher', `🔔 Class dismissed. ${turn.homework ? `Homework: ${turn.homework}` : ''}`);
        set({
          lyoState: turn.lyo_state || 'celebrating',
          canContinue: true,
          caption: null,
          activeSpeaker: null,
        });
        break;

      default:
        break;
    }
    playTimer = setTimeout(playNext, 80);
  }

  function resumePlayer() {
    if (playing) return;
    playing = true;
    set({ isNarrating: true });
    playNext();
  }

  function enqueueTurns(turns: DirectorTurn[]) {
    maybeEraseForNewScene();
    turnQueue.push(...turns);
    set({ waitingForScene: false });
    resumePlayer();
  }

  // ── incoming protocol ──

  function handleComponent(comp: ClassroomComponent) {
    switch (comp.type) {
      case 'TeacherMessage': {
        const text = (comp.text ?? '').trim();
        if (!text) return;
        if (comp.language_code) set({ languageCode: comp.language_code });
        if (text.startsWith('[')) {
          try {
            const turns = JSON.parse(text) as DirectorTurn[];
            if (Array.isArray(turns)) {
              enqueueTurns(turns);
              addSources(comp.source_attributions);
              return;
            }
          } catch { /* plain text below */ }
        }
        enqueueTurns([{ type: 'speech', speaker: 'Teacher', text }]);
        addSources(comp.source_attributions);
        break;
      }
      case 'StudentPrompt':
        enqueueTurns([{ type: 'speech', speaker: comp.student_name || 'Maya', text: comp.text ?? '' }]);
        break;
      case 'QuizCard':
        addBoardElement({ id: nextId(), kind: 'quiz', quiz: comp });
        pushTranscript('Teacher', `📝 Recognition check: ${comp.question ?? ''}`);
        set({ canContinue: false });
        break;
      case 'InputField':
        addBoardElement({ id: nextId(), kind: 'transfer', input: comp });
        pushTranscript('Teacher', `✍️ Application check: ${comp.question ?? ''}`);
        addSources(comp.source_attributions);
        set({ canContinue: false, waitingForScene: false });
        break;
      case 'ExampleBlock':
        addBoardElement({
          id: nextId(),
          kind: 'summary',
          title: comp.title || 'Worked example',
          content: comp.content,
          items: [],
        });
        break;
      case 'LessonBlock':
        if (comp.block_type === 'summary' && comp.block) {
          addBoardElement({
            id: nextId(),
            kind: 'summary',
            title: comp.block.title || 'Lesson summary',
            content: comp.block.content,
            items: comp.block.items || [],
            retrievalScheduled: comp.block.retrieval_scheduled === true,
          });
          addSources(comp.block.source_attributions);
        }
        break;
      case 'ProgressBar': {
        const current = Math.max(0, comp.current ?? 0);
        const total = Math.max(1, comp.total ?? 1);
        set({ progressCurrent: current, progressTotal: total });
        // Keep this course's Stacks entry in sync with the backend's own
        // authoritative mastery-progress signal — non-blocking, mirrors
        // Android's ClassroomEngine.syncStackProgress. sessionId equals
        // the real course id once the classroom route passes a real
        // courseId (falls back to topic otherwise, same as upsert).
        void updateCourseProgress(get().sessionId, current / total);
        break;
      }
      case 'CTAButton':
        set({
          canContinue: true,
          continueLabel: comp.label || 'Continue',
          nextActionIntent: comp.action_intent || 'continue',
          waitingForScene: false,
        });
        break;
      default:
        break;
    }
  }

  function handleMessage(raw: string) {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }
    const et = (msg.event_type as string) || (msg.type as string) || '';

    switch (et) {
      case 'component_render': {
        const comp = (msg.component ?? (msg.data as Record<string, unknown>)?.component ?? msg.data) as ClassroomComponent | undefined;
        if (comp?.type) handleComponent(comp);
        break;
      }
      case 'scene_start':
        // A new scene invalidates every older queued or playing turn.
        stopPlayer();
        turnQueue = [];
        // Mark for erase, but keep the current board up while the teacher
        // "prepares" — it only wipes when the new content arrives.
        pendingErase = true;
        set({
          waitingForScene: true,
          canContinue: false,
          prompt: null,
          caption: null,
          activeSpeaker: null,
        });
        break;
      case 'scene_complete':
        set({ waitingForScene: false });
        break;
      case 'error':
        pushTranscript('System', (msg.message as string) || 'The classroom hit a snag.');
        break;
      default:
        break;
    }
  }

  /**
   * Returns whether the action actually reached the classroom. Callers must
   * check it before optimistically showing "waiting for the teacher" — a
   * silently dropped action used to leave the board spinning forever.
   */
  function sendAction(
    actionIntent: string,
    componentId: string,
    answerData?: Record<string, unknown>,
  ): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const payload: Record<string, unknown> = {
      event_type: 'user_action',
      session_id: get().sessionId,
      action_intent: actionIntent,
      component_id: componentId,
      timestamp: new Date().toISOString(),
    };
    if (answerData) payload.answer_data = answerData;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /** Surfaces a dropped action instead of hanging the board. */
  function reportOffline() {
    set({
      waitingForScene: false,
      error: 'That did not reach the classroom — the session is not connected.',
    });
  }

  return {
    status: 'idle',
    topic: '',
    sessionId: '',
    objective: '',
    languageCode: 'auto',
    board: [],
    boardHistory: [],
    viewingBoard: -1,
    caption: null,
    activeSpeaker: null,
    prompt: null,
    transcript: [],
    lyoState: 'reading',
    waitingForScene: false,
    isNarrating: false,
    canContinue: false,
    progressCurrent: 0,
    progressTotal: 1,
    continueLabel: 'Check understanding',
    nextActionIntent: 'continue',
    error: null,
    soundOn: false,
    voiceOn: true,
    speechRate: 1,
    isPaused: false,

    connect: (connection: ClassroomConnection) => {
      get().disconnect();
      const token = typeof window !== 'undefined' ? localStorage.getItem('lyo_token') : null;
      if (!token) {
        set({
          status: 'error',
          error: 'Sign in to start a secure AI classroom.',
          waitingForScene: false,
        });
        return;
      }
      authToken = token;
      idCounter = 0;
      turnQueue = [];
      pendingErase = false;
      const sessionId = connection.sessionId || connection.topic;
      set({
        status: 'connecting',
        topic: connection.topic,
        sessionId,
        objective: connection.objective || '',
        languageCode: connection.language || 'auto',
        board: [], boardHistory: [], viewingBoard: -1,
        caption: null, activeSpeaker: null, prompt: null, transcript: [],
        lyoState: 'reading', waitingForScene: true, isNarrating: false, canContinue: false,
        progressCurrent: 0, progressTotal: 1,
        continueLabel: 'Check understanding', nextActionIntent: 'continue', error: null,
      });

      const socket = new WebSocket(wsUrl({ ...connection, sessionId }, token));
      ws = socket;
      socket.onopen = () => set({ status: 'live' });
      socket.onmessage = (e) => handleMessage(String(e.data));
      socket.onerror = () => {
        if (ws === socket) set({ status: 'error', error: 'Connection to the classroom failed.' });
      };
      socket.onclose = () => {
        if (ws === socket) {
          set((s) => ({ status: s.transcript.length > 0 ? 'ended' : s.status === 'error' ? 'error' : 'ended' }));
          ws = null;
        }
      };
    },

    disconnect: () => {
      stopPlayer();
      turnQueue = [];
      authToken = null;
      if (ws) { try { ws.close(); } catch { /* noop */ } ws = null; }
      set({ status: 'idle' });
    },

    answerPrompt: (option: string) => {
      const prompt = get().prompt;
      if (!prompt) return;
      // Keep the prompt on screen if it could not be delivered, rather than
      // dismissing a question the classroom never received.
      if (!sendAction('user_message', prompt.id, { message: option })) {
        reportOffline();
        return;
      }
      learnerTakesFloor();
      pushTranscript('You', option);
      set({ prompt: null, lyoState: 'listening' });
    },

    answerQuiz: (elementId, option) => {
      const el = get().board.find((b) => b.id === elementId);
      if (!el || el.kind !== 'quiz' || el.answered) return;
      learnerTakesFloor();
      // Do not lock the card to an answer the classroom never received.
      if (!sendAction('submit_answer', el.quiz.component_id, {
        selected_option_id: option.id,
        selected_option_label: option.label,
      })) {
        reportOffline();
        return;
      }
      set((state) => ({
        board: state.board.map((item) =>
          item.id === elementId && item.kind === 'quiz'
            ? { ...item, answered: option.label }
            : item),
        lyoState: 'thinking',
        waitingForScene: true,
      }));
      pushTranscript('You', option.label);
    },

    answerTransfer: (elementId: string, response: string) => {
      const el = get().board.find((b) => b.id === elementId);
      if (!el || el.kind !== 'transfer' || el.submitted) return;
      const trimmed = response.trim();
      if (!trimmed) return;
      learnerTakesFloor();
      // Keep the learner's writing editable if it could not be delivered.
      if (!sendAction(el.input.action_intent || 'submit_transfer', el.input.component_id, {
        response: trimmed,
      })) {
        reportOffline();
        return;
      }
      set((state) => ({
        board: state.board.map((item) =>
          item.id === elementId && item.kind === 'transfer'
            ? { ...item, response: trimmed, submitted: true }
            : item),
        waitingForScene: true,
        lyoState: 'thinking',
      }));
      // Name the rung the component actually asked for. Labelling an
      // explanation prompt "Application" misreports the learner's own
      // transcript back to them.
      pushTranscript('You', `${transcriptLabelFor(el.input.evidence_type)}: ${trimmed}`);
    },

    skipQuestion: (elementId: string) => {
      const el = get().board.find((b) => b.id === elementId);
      if (!el || (el.kind !== 'quiz' && el.kind !== 'transfer')) return;
      if ((el.kind === 'quiz' && el.answered) || (el.kind === 'transfer' && el.submitted) || el.skipped) return;

      learnerTakesFloor();
      const componentId = el.kind === 'quiz' ? el.quiz.component_id : el.input.component_id;
      if (!sendAction('skip_question', componentId, { reason: 'unsure' })) {
        reportOffline();
        return;
      }
      set((state) => ({
        board: state.board.map((item) =>
          item.id === elementId && (item.kind === 'quiz' || item.kind === 'transfer')
            ? { ...item, skipped: true }
            : item),
        canContinue: false,
        waitingForScene: true,
        lyoState: 'thinking',
      }));
      pushTranscript(
        'You',
        get().languageCode.toLowerCase().startsWith('es')
          ? 'Omití esta pregunta para repasarla después'
          : 'Skipped this question for later review',
      );
    },

    unskipQuestion: (elementId: string) => {
      const el = get().board.find((b) => b.id === elementId);
      if (!el || (el.kind !== 'quiz' && el.kind !== 'transfer') || !el.skipped) return;

      learnerTakesFloor();
      const componentId = el.kind === 'quiz' ? el.quiz.component_id : el.input.component_id;
      if (!sendAction('retry', componentId)) {
        reportOffline();
        return;
      }
      set((state) => ({
        board: state.board.map((item) =>
          item.id === elementId && (item.kind === 'quiz' || item.kind === 'transfer')
            ? { ...item, skipped: false }
            : item),
        waitingForScene: true,
        lyoState: 'thinking',
      }));
      pushTranscript(
        'You',
        get().languageCode.toLowerCase().startsWith('es')
          ? 'Volví a la pregunta omitida'
          : 'Returned to the skipped question',
      );
    },

    askQuestion: (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      learnerTakesFloor();
      if (!sendAction('ask_question', 'web_ask', { message: trimmed })) {
        reportOffline();
        return;
      }
      pushTranscript('You', `✋ ${trimmed}`);
      set({ waitingForScene: true, lyoState: 'curious', caption: { speaker: 'You', text: trimmed } });
    },

    takeFloor: () => learnerTakesFloor(),

    signal: (kind) => {
      learnerTakesFloor();
      if (!sendAction(kind === 'confused' ? 'request_hint' : 'skip_ahead', 'web_signal',
        kind === 'confused' ? { hint_level: 'nudge' } : undefined)) {
        reportOffline();
        return;
      }
      set({ waitingForScene: true, lyoState: kind === 'confused' ? 'thinking' : 'curious' });
      pushTranscript('You', kind === 'confused' ? 'Requested a small nudge' : 'Requested a harder case');
    },

    requestHint: (level) => {
      const labels: Record<HintLevel, string> = {
        nudge: 'small nudge',
        principle: 'governing principle',
        worked_step: 'first worked step',
        full_example: 'full worked example',
        prerequisite: 'prerequisite refresher',
      };
      learnerTakesFloor();
      if (!sendAction('request_hint', 'web_hint', { hint_level: level })) {
        reportOffline();
        return;
      }
      set({ waitingForScene: true, lyoState: 'thinking' });
      pushTranscript('You', `Requested: ${labels[level]}`);
    },

    continueLesson: () => {
      const actionIntent = get().nextActionIntent || 'continue';
      learnerTakesFloor();
      // Leave the Continue button in place if the action never left the
      // browser — clearing canContinue would strip the only way forward.
      if (!sendAction(actionIntent, 'web_continue')) {
        reportOffline();
        return;
      }
      set({
        canContinue: false,
        waitingForScene: true,
        continueLabel: 'Check understanding',
        nextActionIntent: 'continue',
      });
    },

    skipTurn: () => {
      // Nothing playing to cut short: idle, paused, or the learner already
      // owns the floor (a prompt/quiz/transfer is waiting on them — those
      // are answered or explicitly skipped, never fast-forwarded past).
      if (!playing || get().isPaused) return;
      if (playTimer) { clearTimeout(playTimer); playTimer = null; }
      // Bumps speechGeneration, so a real TTS request or utterance already
      // in flight for the turn being skipped becomes a no-op instead of
      // firing its onDone (which would otherwise double-advance the queue).
      stopSpeech();
      // Clear the caption/speaker being cut short rather than leaving it in
      // place. Without this, skipping into a board/pause/ambient turn (none
      // of which touch `caption`) left the old line's word-reveal ticker
      // running on the UI side, still typing out content the learner had
      // just jumped past. If the next turn is itself a speech turn it sets
      // its own fresh caption right away, so this only ever shows a blank
      // beat, never a wrong one.
      set({ caption: null, activeSpeaker: null });
      playNext();
    },

    toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
    toggleVoice: () => {
      const next = !get().voiceOn;
      set({ voiceOn: next });
      if (!next) {
        if (playTimer) { clearTimeout(playTimer); playTimer = null; }
        stopSpeech();
        if (playing) playNext();
      }
    },
    // The single most accessible control: stop the class right where it
    // is. Pausing cancels the turn currently speaking/animating and holds
    // the turn queue — it does not lose anything already on the board or
    // in the transcript. Resuming continues with the NEXT turn (the
    // interrupted line doesn't replay from the top; browser TTS
    // pause/resume-mid-utterance is unreliable enough across engines that
    // a clean stop-and-continue is the more trustworthy behavior).
    togglePause: () => {
      if (get().isPaused) {
        set({ isPaused: false });
        resumePlayer();
      } else {
        stopPlayer();
        set({ isPaused: true, activeSpeaker: null });
      }
    },
    setSpeechRate: (rate: number) => set({
      speechRate: Math.max(0.75, Math.min(1.25, rate)),
    }),

    viewBoard: (index: number) => set({ viewingBoard: index }),
  };
});
