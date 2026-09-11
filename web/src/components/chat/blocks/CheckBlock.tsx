'use client';

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Check, X, Lightbulb, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat-store';
import type { ChatBlock, ChatMessage, ChatQuizContent } from '@/types';
import {
  markdownComponents,
  MARKDOWN_MATH_PLUGINS,
  normalizeLatexDelimiters,
} from '../markdown-config';

const inlineMarkdownComponents = {
  ...markdownComponents,
  p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
};

function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown components={inlineMarkdownComponents} {...MARKDOWN_MATH_PLUGINS}>
      {normalizeLatexDelimiters(text)}
    </ReactMarkdown>
  );
}

/**
 * An answerable check inside a chat lesson.
 *
 * The verdict comes from the server. This component deliberately does NOT
 * compare the selection against `correct_index`, because deciding correctness
 * on the client is the exact failure this feature exists to remove.
 *
 * That field is no longer on the wire either: the server strips the answer
 * key, the explanation and the per-option misconception tags before a block
 * leaves it, so the discipline is enforced rather than merely observed. What
 * this renders after an answer comes from the server's verdict.
 */
export default function CheckBlock({
  block,
  message,
}: {
  block: ChatBlock;
  message: ChatMessage;
}) {
  const answerCheck = useChatStore((s) => s.answerCheck);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const shownAt = useRef(Date.now());

  const content = block.content as unknown as ChatQuizContent;
  const result = message.checkResults?.[block.id];
  const answered = Boolean(result);

  const options = useMemo(() => content?.options ?? [], [content]);
  if (!content?.question || options.length === 0) return null;

  const bailoutIndex = content.bailout_index ?? null;

  const onPick = async (index: number) => {
    if (answered || pendingIndex !== null) return;
    setPendingIndex(index);
    try {
      await answerCheck(message.id, block.id, index, Date.now() - shownAt.current, hintShown);
    } finally {
      setPendingIndex(null);
    }
  };

  // The server echoes back which option was chosen, so the selection survives
  // a reload without the client having to remember it.
  const chosenIndex = result ? result.selected_index : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
      <div className="prose-invert prose-sm max-w-none text-white/90 mb-3">
        <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
          {normalizeLatexDelimiters(content.question)}
        </ReactMarkdown>
      </div>

      <div className="flex flex-col gap-2" role="group" aria-label="Answer options">
        {options.map((option, index) => {
          const isBailout = bailoutIndex === index;
          const isCorrectAnswer = answered && index === result!.correct_index;
          const isChosen = answered && chosenIndex === index;
          const isWrongChoice = isChosen && !result!.correct && !result!.bailed_out;

          return (
            <button
              key={option.id ?? index}
              type="button"
              disabled={answered || pendingIndex !== null}
              onClick={() => onPick(index)}
              aria-pressed={isChosen}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-colors',
                'flex items-center gap-2',
                !answered && 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20',
                !answered && isBailout && 'text-white/50 italic',
                answered && isCorrectAnswer && 'border-emerald-500/40 bg-emerald-500/10 text-white',
                answered && isWrongChoice && 'border-rose-500/40 bg-rose-500/10 text-white',
                answered && !isCorrectAnswer && !isWrongChoice && 'border-white/5 bg-white/[0.02] text-white/40',
                (answered || pendingIndex !== null) && 'cursor-default'
              )}
            >
              {pendingIndex === index ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin text-white/60" aria-hidden="true" />
              ) : answered && isCorrectAnswer ? (
                <Check className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />
              ) : answered && isWrongChoice ? (
                <X className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
              ) : (
                <span className="w-4 h-4 shrink-0 rounded-full border border-white/25" />
              )}
              <span className="min-w-0"><InlineMarkdown text={option.text} /></span>
            </button>
          );
        })}
      </div>

      {/* A hint is available before answering — asking for one is not failure. */}
      {!answered && content.hint && (
        <button
          type="button"
          onClick={() => setHintShown(true)}
          disabled={hintShown}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 disabled:hover:text-white/50"
        >
          <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
          {hintShown ? <InlineMarkdown text={content.hint} /> : 'Need a hint?'}
        </button>
      )}

      {answered && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 pt-3 border-t border-white/10"
          aria-live="polite"
        >
          <p
            className={cn(
              'text-sm font-medium mb-1',
              result!.bailed_out
                ? 'text-white/70'
                : result!.correct
                  ? 'text-emerald-300'
                  : 'text-rose-300'
            )}
          >
            {result!.bailed_out
              ? 'No problem — here it is.'
              : result!.correct
                ? 'Correct.'
                : 'Not quite.'}
          </p>

          {/* Naming the specific confusion is the point — not just "wrong". */}
          {!result!.correct && result!.misconception && (
            <div className="text-sm text-white/60 mb-1">
              <InlineMarkdown text={result!.misconception} />
            </div>
          )}

          {result!.explanation && (
            <div className="prose-invert prose-sm max-w-none text-white/80">
              <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
                {normalizeLatexDelimiters(result!.explanation)}
              </ReactMarkdown>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
