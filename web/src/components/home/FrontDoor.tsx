'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { GraduationCap, CalendarClock, ArrowRight } from 'lucide-react';
import { classroomEntryHref, testPrepEntryHref } from '@/lib/entry-contract.mjs';

/**
 * LYO's front door.
 *
 * What a first-time visitor used to get was a dashboard of their own
 * nothing: Level 1, 0 XP, 0 hours, 0 courses, empty recommendations, and a
 * greeting addressed to "Learner". A zero dashboard asks someone to admire an
 * empty account before it has given them anything.
 *
 * What they get instead is the one question the product is actually built to
 * answer, and a door into the Classroom. The Classroom is the demonstration:
 * nothing written here argues that LYO is more than a chatbot as well as
 * ninety seconds inside one does.
 *
 * Both CTAs land on real runtime paths:
 *  - "Enter Classroom" opens the live classroom on the typed topic. The
 *    classroom WebSocket accepts a null token, so a guest can be taught
 *    before being asked to register.
 *  - "I have a test" opens Chat with that opening turn, which the backend
 *    router resolves to its real TEST_PREP intent and which then asks for
 *    subject, date and materials.
 *
 * See docs/CLASSROOM_ARCHITECTURE.md section 5.
 */

const EXAMPLES = [
  'AP Chemistry',
  'Spanish for my trip',
  'SQL for a job interview',
  'Teach me fractions',
];

export default function FrontDoor({ knownLearner = false }: { knownLearner?: boolean }) {
  const router = useRouter();
  const [topic, setTopic] = useState('');

  const trimmed = topic.trim();

  const enterClassroom = () => {
    const href = classroomEntryHref({ topic: trimmed });
    if (!href) return;
    router.push(href);
  };

  const startTestPrep = () => {
    router.push(testPrepEntryHref());
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[32px] ios-card-gradient border border-white/20 p-6 sm:p-10 shadow-[0_8px_20px_rgba(0,0,0,0.3)]"
      aria-labelledby="front-door-heading"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.15) 0%, transparent 45%)' }}
      />
      <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/15 blur-[46px] pointer-events-none" />

      <div className="relative">
        <h1
          id="front-door-heading"
          className="font-rounded text-[32px] sm:text-[40px] font-extrabold leading-tight text-white"
        >
          What do you want to learn?
        </h1>

        <p className="mt-3 max-w-xl text-sm sm:text-base font-medium text-white/75">
          LYO teaches you live, checks what you understand, adapts when you&apos;re stuck,
          and remembers what you&apos;ve mastered.
        </p>

        <form
          className="mt-6 flex flex-col sm:flex-row gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            enterClassroom();
          }}
        >
          <label htmlFor="front-door-topic" className="sr-only">
            What do you want to learn?
          </label>
          <input
            id="front-door-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Anything — a subject, a skill, a chapter you're stuck on"
            autoComplete="off"
            className="flex-1 min-w-0 rounded-2xl bg-black/25 border border-white/20 px-5 py-4
              text-base text-white placeholder-white/45 outline-none backdrop-blur-md
              focus:border-white/45 transition-colors"
          />
          <button
            type="submit"
            disabled={!trimmed}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-4
              text-base font-bold text-[#1b1035] bg-white
              transition-all duration-200 hover:scale-[1.02] active:scale-95
              disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <GraduationCap size={18} />
            Enter Classroom
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-white/50">Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setTopic(example)}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5
                text-xs font-medium text-white/80 backdrop-blur-md
                transition-colors hover:bg-white/20 hover:text-white"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t border-white/15">
          <button
            type="button"
            onClick={startTestPrep}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10
              px-5 py-3 text-sm font-semibold text-white backdrop-blur-md
              transition-all duration-200 hover:bg-white/20 active:scale-95"
          >
            <CalendarClock size={16} />
            I have a test
            <ArrowRight size={15} className="opacity-70" />
          </button>
          <p className="mt-2 text-xs text-white/55">
            {knownLearner
              ? 'Bring the date and your notes — LYO builds the plan around what you already know.'
              : 'Bring the date and your notes. LYO finds what you already know and what you don’t.'}
          </p>
        </div>
      </div>
    </motion.section>
  );
}
