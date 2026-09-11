'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check, Lightbulb, Code, BookOpen, CheckCircle } from 'lucide-react';
import { Lesson, LessonBlock, Quiz, Flashcard } from '@/types';
import { masteryPercent } from '@/lib/learner-model.mjs';
import { cn } from '@/lib/utils';
import QuizView from './QuizView';

interface LessonViewProps {
  lesson: Lesson;
  onComplete?: () => void;
  isCompleted?: boolean;
}

// ── Code block with copy ─────────────────────────────────────────────────────

function CodeBlock({ block }: { block: LessonBlock }) {
  const [copied, setCopied] = useState(false);
  const language = (block.metadata?.language as string) ?? 'code';

  function handleCopy() {
    navigator.clipboard.writeText(block.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <span className="text-xs font-mono text-white/40 uppercase tracking-widest">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre>
          <code className="text-green-400 text-sm font-mono whitespace-pre">
            {block.content}
          </code>
        </pre>
      </div>
    </div>
  );
}

// ── Heading block ────────────────────────────────────────────────────────────

function HeadingBlock({ block }: { block: LessonBlock }) {
  const level = (block.metadata?.level as number) ?? 2;
  const gradientClass =
    'bg-gradient-to-r from-lyo-400 to-lyo-600 bg-clip-text text-transparent';

  if (level === 1) {
    return (
      <h1 className={cn('font-bold text-3xl leading-tight', gradientClass)}>
        {block.content}
      </h1>
    );
  }
  if (level === 3) {
    return (
      <h3 className={cn('font-semibold text-xl leading-snug', gradientClass)}>
        {block.content}
      </h3>
    );
  }
  return (
    <h2 className={cn('font-bold text-2xl leading-snug', gradientClass)}>
      {block.content}
    </h2>
  );
}

// ── Flashcard block ──────────────────────────────────────────────────────────

function FlashcardBlock({ block }: { block: LessonBlock }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const card = block.content as unknown as Flashcard;

  return (
    <div
      onClick={() => setIsFlipped((f) => !f)}
      className="cursor-pointer select-none"
      style={{ perspective: '1000px' }}
    >
      <motion.div
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', position: 'relative', minHeight: '180px' }}
      >
        {/* Front */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-lyo-600/20 to-purple-600/20 border border-lyo-500/30 rounded-2xl p-6 flex flex-col items-center justify-center gap-3"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {card.category && (
            <span className="text-xs font-medium text-lyo-400 uppercase tracking-widest">
              {card.category}
            </span>
          )}
          <p className="text-white text-center text-lg font-semibold">{card.front}</p>
          <p className="text-white/40 text-xs mt-2">Click to flip</p>
        </div>

        {/* Back */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-purple-600/20 to-lyo-600/20 border border-lyo-500/30 rounded-2xl p-6 flex flex-col items-center justify-center gap-3"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <p className="text-white/80 text-center leading-relaxed">{card.back}</p>
          {/* The backend stores mastery as a 0..1 float; this bar previously
              assumed 0..100, so a well-mastered card drew a 0.7%-wide sliver.
              masteryPercent accepts either scale and returns null when there
              is no reading at all, which is not the same as zero. */}
          {masteryPercent(card.mastery) !== null && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-white/40">Mastery</span>
              <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-lyo-500 to-purple-500 rounded-full"
                  style={{ width: `${masteryPercent(card.mastery)}%` }}
                />
              </div>
            </div>
          )}
          <p className="text-white/40 text-xs mt-1">Click to flip back</p>
        </div>
      </motion.div>
    </div>
  );
}

// ── Accent boxes ─────────────────────────────────────────────────────────────

function AnalogyBlock({ block }: { block: LessonBlock }) {
  return (
    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-yellow-400" />
        <span className="text-yellow-400 text-sm font-semibold uppercase tracking-wide">
          Analogy
        </span>
      </div>
      <p className="text-yellow-100/80 leading-relaxed text-sm">{block.content}</p>
    </div>
  );
}

function SummaryBlock({ block }: { block: LessonBlock }) {
  const items = Array.isArray(block.content) ? block.content : [block.content];

  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle className="w-4 h-4 text-blue-400" />
        <span className="text-blue-400 text-sm font-semibold uppercase tracking-wide">
          Summary
        </span>
      </div>
      {items.length > 1 ? (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-blue-100/80 text-sm">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
              {String(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-blue-100/80 leading-relaxed text-sm">{String(items[0])}</p>
      )}
    </div>
  );
}

function ExerciseBlock({ block }: { block: LessonBlock }) {
  return (
    <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Code className="w-4 h-4 text-purple-400" />
        <span className="text-purple-400 text-sm font-semibold uppercase tracking-wide">
          Exercise
        </span>
      </div>
      <p className="text-purple-100/80 leading-relaxed text-sm">{block.content}</p>
    </div>
  );
}

// ── Block renderer ────────────────────────────────────────────────────────────

function BlockRenderer({
  block,
  onLessonComplete,
}: {
  block: LessonBlock;
  onLessonComplete?: () => void;
}) {
  switch (block.type) {
    case 'heading':
      return <HeadingBlock block={block} />;

    case 'text':
      return (
        <p className="text-white/80 leading-relaxed">{block.content}</p>
      );

    case 'code':
      return <CodeBlock block={block} />;

    case 'image':
      return (
        <img
          src={block.content}
          alt={(block.metadata?.alt as string) ?? ''}
          className="rounded-xl border border-white/10 w-full object-cover"
        />
      );

    case 'quiz':
      return (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <QuizView
            quiz={block.content as unknown as Quiz}
            inline
            onComplete={() => onLessonComplete?.()}
          />
        </div>
      );

    case 'flashcard':
      return <FlashcardBlock block={block} />;

    case 'analogy':
      return <AnalogyBlock block={block} />;

    case 'summary':
      return <SummaryBlock block={block} />;

    case 'exercise':
      return <ExerciseBlock block={block} />;

    default:
      return (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-white/60 text-sm">
          {block.content}
        </div>
      );
  }
}

// ── LessonView ────────────────────────────────────────────────────────────────

export default function LessonView({ lesson, onComplete, isCompleted }: LessonViewProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Lesson title */}
      <div className="flex items-start gap-3">
        <BookOpen className="w-5 h-5 text-lyo-400 mt-1 flex-shrink-0" />
        <h1 className="text-white text-2xl font-bold leading-tight">{lesson.title}</h1>
      </div>

      {/* Content blocks with staggered animation */}
      {lesson.content.map((block, index) => (
        <motion.div
          key={block.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
        >
          <BlockRenderer block={block} onLessonComplete={onComplete} />
        </motion.div>
      ))}

      {/* Complete button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: lesson.content.length * 0.05 + 0.1, duration: 0.3 }}
        className="flex justify-end pt-4 border-t border-white/10"
      >
        <button
          onClick={() => !isCompleted && onComplete?.()}
          disabled={isCompleted}
          className={cn(
            'flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-all duration-200',
            isCompleted
              ? 'bg-green-500/20 border border-green-500/40 cursor-default'
              : 'bg-gradient-to-r from-lyo-500 to-lyo-600 hover:opacity-90 active:scale-95'
          )}
        >
          {isCompleted ? (
            <>
              <Check className="w-5 h-5 text-green-400" />
              <span className="text-green-400">Completed</span>
            </>
          ) : (
            <>
              <CheckCircle className="w-5 h-5" />
              Mark as Complete
            </>
          )}
        </button>
      </motion.div>
    </div>
  );
}
