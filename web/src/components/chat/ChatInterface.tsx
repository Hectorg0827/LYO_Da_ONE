'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore, type GenerationActivity } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';
import MessageBubble from './MessageBubble';
import ChatInputBar from './ChatInputBar';
import SuggestionChips from './SuggestionChips';
import MascotAvatar from './MascotAvatar';
import SessionRecap from './SessionRecap';
import DueReviewsNudge from './DueReviewsNudge';

// ─── LYO Mascot hero (matches iOS LyoOverlayView avatarLayer) ────────────────
// iOS renders this at 200pt on a full-screen overlay; the web chat sits under
// a top bar and above the tab bar, so the mascot scales down on short screens.
function LYOOrb() {
  return (
    <div className="relative flex items-center justify-center mt-4 sm:mt-10">
      {/* Orange radial glow behind the mascot */}
      <div className="absolute w-[190px] h-[190px] sm:w-[280px] sm:h-[280px] rounded-full mascot-glow pointer-events-none" />
      <div
        className="relative animate-mascot-float flex items-center justify-center
          [&_img]:w-[135px] [&_img]:h-[135px] sm:[&_img]:w-[200px] sm:[&_img]:h-[200px]"
      >
        <MascotAvatar size={200} />
      </div>
    </div>
  );
}

// ─── Thinking animation ───────────────────────────────────────────────────────
// Mirrors iOS LyoUnifiedThinkingIndicator: cycling mascot reading frames, a
// label that rotates through phases with its own tint, and three pulsing dots.
const THINKING_PHASES = [
  { label: 'Thinking…', color: '#6366f1' },
  { label: 'Analyzing…', color: '#8b5cf6' },
  { label: 'Processing…', color: '#ec4899' },
];

function ThinkingIndicator() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setPhase((p) => (p + 1) % THINKING_PHASES.length),
      2000
    );
    return () => clearInterval(id);
  }, []);

  const { label, color } = THINKING_PHASES[phase];

  return (
    <div className="flex items-end gap-3 w-full">
      <MascotAvatar thinking size={32} />
      <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-black/40 border border-white/10 backdrop-blur-sm flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: color }}
            animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: i * 0.18,
              ease: 'easeInOut',
            }}
          />
        ))}
        <AnimatePresence mode="wait">
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="ml-2 text-sm font-medium"
            style={{ color }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Generation progress bar ──────────────────────────────────────────────────
export function getGenerationStatusLabel(
  progress: number,
  activity: GenerationActivity
) {
  switch (activity) {
    case 'course':
      return progress >= 75 ? 'Finalizing your course…' : 'Preparing your course…';
    case 'response':
      return progress >= 75 ? 'Finalizing response…' : 'Generating response…';
    case 'thinking':
    default:
      return 'Thinking…';
  }
}

function GenerationProgressBar({
  progress,
  activity,
}: {
  progress: number;
  activity: GenerationActivity;
}) {
  const label = getGenerationStatusLabel(progress, activity);

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between mb-1">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.2 }}
              className="block text-xs text-white/40"
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </div>
        <span className="text-xs text-lyo-400 font-medium">{progress}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-lyo-500 via-accent-purple to-accent-pink"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ─── Empty state (matches iOS LyoOverlayView greeting) ───────────────────────
function EmptyState() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.displayName?.trim().split(' ')[0] || 'there';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center h-full min-h-full px-4 py-4 sm:py-8 text-center"
    >
      <h1 className="font-rounded text-[26px] sm:text-[32px] font-bold leading-tight">
        <span className="hello-gradient-text">Hello, {firstName}!</span>
      </h1>
      <p className="mt-2 text-base sm:text-lg font-medium text-white/80">
        Ready to embark on a learning journey?
      </p>
      <LYOOrb />
      <SessionRecap />
      <div className="flex-1 min-h-4" />
      <DueReviewsNudge />
      <div className="h-2" />
      <SuggestionChips />
    </motion.div>
  );
}

// ─── Main ChatInterface ───────────────────────────────────────────────────────
export default function ChatInterface() {
  const {
    getActiveConversation,
    isGenerating,
    generationProgress,
    generationActivity,
    hydrate,
    fetchDueReviews,
    sendMessage,
  } = useChatStore();
  const conversation = getActiveConversation();
  const messages = conversation?.messages ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const seededPrompt = searchParams.get('prompt');
  const seededOnce = useRef(false);

  useEffect(() => {
    hydrate();
    // Checked once per app open, same cadence as hydrate() — a nudge that's
    // still due an hour into the session isn't suddenly less due.
    fetchDueReviews();
  }, [hydrate, fetchDueReviews]);

  /**
   * `?prompt=` lets another surface hand Chat an opening turn.
   *
   * Home's "I have a test" entry uses it: Test Prep is a real backend intent
   * (TEST_PREP in lyo_app/ai/router.py) reached by what the learner says, so
   * the honest way to open that flow is to actually say it and let the router
   * ask for subject, date and materials. No parallel client-side test-prep
   * mock sits in front of it.
   *
   * The send is ordered behind hydration rather than racing it. On a fresh
   * load hydrate() finishes by replacing the conversation list, clearing the
   * active id and opening a new chat — so a turn sent first lands in a
   * conversation that is then thrown away, and the learner arrives at an
   * empty chat with their opening turn missing. hydrate() returns its
   * in-flight promise to concurrent callers, so awaiting it here is enough.
   *
   * Guarded by a ref rather than by message count so a re-render (or a reply
   * arriving) can never re-send it.
   */
  useEffect(() => {
    if (!seededPrompt || seededOnce.current) return;
    seededOnce.current = true;
    let cancelled = false;
    void (async () => {
      await hydrate();
      if (!cancelled) void sendMessage(seededPrompt);
    })();
    return () => {
      cancelled = true;
    };
  }, [seededPrompt, sendMessage, hydrate]);

  // Auto-scroll when messages change or while generating

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isGenerating]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-transparent">
      {/* Message list or empty state */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-6 py-6 w-full">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </AnimatePresence>

            {/* Thinking indicator */}
            <AnimatePresence>
              {isGenerating && (
                <motion.div
                  key="thinking"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.25 }}
                >
                  <ThinkingIndicator />
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Progress bar */}
      <AnimatePresence>
        {isGenerating && generationProgress > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 border-t border-white/5"
          >
            <GenerationProgressBar
              progress={generationProgress}
              activity={generationActivity}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input bar */}
      <div className="shrink-0">
        <ChatInputBar />
      </div>
    </div>
  );
}

