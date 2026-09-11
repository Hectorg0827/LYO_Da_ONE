'use client';

import ReactMarkdown from 'react-markdown';
import { AlertTriangle } from 'lucide-react';
import katex from 'katex';
import { cn } from '@/lib/utils';
import type { ChatBlock, ChatMessage } from '@/types';
import {
  markdownComponents,
  MARKDOWN_MATH_PLUGINS,
  normalizeLatexDelimiters,
  unwrapLatexDelimiters,
} from '../markdown-config';
import CheckBlock from './CheckBlock';
import ExplorableBlock from './ExplorableBlock';

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

/** Prose beat. `subtype` carries which beat of the lesson this is. */
function TextBlock({ block }: { block: ChatBlock }) {
  const text = typeof block.content?.text === 'string' ? block.content.text : '';
  if (!text) return null;

  // The hook opens a lesson and reads as a lead-in, not body copy.
  const isHook = block.subtype === 'hook';

  return (
    <div
      className={cn(
        'prose-invert prose-sm max-w-none',
        isHook && 'text-[15px] text-white/90 font-medium'
      )}
    >
      <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
        {normalizeLatexDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * A highlighted aside — the "common mistakes" beat.
 *
 * Visually distinct on purpose: pre-empting an error only works if the learner
 * notices it isn't ordinary body text.
 */
function CalloutBlock({ block }: { block: ChatBlock }) {
  const text = typeof block.content?.text === 'string' ? block.content.text : '';
  if (!text) return null;

  const variant = typeof block.content?.style === 'string' ? block.content.style : 'trap';
  const tone =
    variant === 'insight'
      ? 'border-lyo-500/30 bg-lyo-500/10'
      : variant === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10'
        : 'border-rose-500/30 bg-rose-500/10';
  const iconTone =
    variant === 'insight'
      ? 'text-lyo-300'
      : variant === 'warning'
        ? 'text-amber-300'
        : 'text-rose-300';

  return (
    <div className={cn('rounded-2xl border p-4 flex gap-3', tone)}>
      <AlertTriangle className={cn('w-4 h-4 mt-0.5 shrink-0', iconTone)} aria-hidden="true" />
      <div className="prose-invert prose-sm max-w-none text-white/85">
        <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
          {normalizeLatexDelimiters(text)}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/** Rendered display-mode LaTeX, matching the classroom board's treatment. */
function MathBlock({ source }: { source: string }) {
  let html = '';
  const normalizedSource = unwrapLatexDelimiters(source);
  try {
    html = katex.renderToString(normalizedSource, { throwOnError: false, displayMode: true });
  } catch {
    // Never lose the formula: fall back to showing its source.
    return (
      <pre className="text-white/80 font-mono text-sm overflow-x-auto py-1">{source}</pre>
    );
  }
  return (
    <div
      className="text-white text-lg overflow-x-auto py-1 [&_.katex]:text-white"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** dataViz: a math formula, a reference table, or a diagram source. */
function DataVizBlock({ block }: { block: ChatBlock }) {
  const source = typeof block.content?.source === 'string' ? block.content.source : '';
  const format = typeof block.content?.format === 'string' ? block.content.format : 'text';
  const title = typeof block.content?.title === 'string' ? block.content.title : null;
  if (!source) return null;

  if (format === 'math') return <MathBlock source={source} />;

  // `table` is markdown; `text` is prose. Both render through the shared
  // markdown pipeline — a text-format block must not come out monospaced.
  if (format === 'table' || format === 'text') {
    return (
      <div>
        {title && (
          <div className="text-sm font-medium text-white/70 mb-2">
            <InlineMarkdown text={title} />
          </div>
        )}
        <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
          {normalizeLatexDelimiters(source)}
        </ReactMarkdown>
      </div>
    );
  }

  // Diagram formats (mermaid, chart) have no renderer here yet. Show the
  // source rather than a blank gap, so nothing silently disappears.
  return (
    <pre className="text-white/70 font-mono text-xs overflow-x-auto p-3 rounded-xl bg-black/30 border border-white/10">
      {source}
    </pre>
  );
}

/**
 * Best-effort rendering for a declared block type that has no bespoke
 * renderer yet (code, flashcard, media, progress, interactive, masteryMap).
 *
 * These must not be dropped: the prose bubble is suppressed whenever blocks
 * are present, so silently skipping a block loses that content entirely — and
 * a turn carrying only such a block would render an empty bubble. Pull out
 * whatever human-readable strings the payload has rather than showing nothing.
 */
function GenericBlock({ block }: { block: ChatBlock }) {
  const content = (block.content ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof content[key] === 'string' ? (content[key] as string) : null);

  const code = str('code');
  if (code) {
    return (
      <pre className="overflow-x-auto p-3 rounded-xl bg-black/40 border border-white/10">
        <code className="text-lyo-300 font-mono text-sm">{code}</code>
      </pre>
    );
  }

  const front = str('front');
  if (front) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="prose-invert prose-sm max-w-none text-white/90 font-medium">
          <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
            {normalizeLatexDelimiters(front)}
          </ReactMarkdown>
        </div>
        {str('back') && (
          <div className="prose-invert prose-sm max-w-none text-white/60 mt-2">
            <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
              {normalizeLatexDelimiters(str('back')!)}
            </ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  if (typeof content.completed === 'number' && typeof content.total === 'number') {
    const pct = content.total > 0 ? Math.round((content.completed / content.total) * 100) : 0;
    return (
      <div className="text-xs text-white/60">
        {str('label') ? <InlineMarkdown text={str('label')!} /> : 'Progress'}: {content.completed}/{content.total} ({pct}%)
      </div>
    );
  }

  const items = Array.isArray(content.items) ? content.items : null;
  if (items?.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        {str('title') && (
          <div className="text-sm font-medium text-white/70 mb-2">
            <InlineMarkdown text={str('title')!} />
          </div>
        )}
        <ul className="space-y-1.5">
          {items.map((item, i) => {
            const entry = item as Record<string, unknown>;
            const label = String(entry.label ?? entry.title ?? '');
            const detail = entry.detail ? String(entry.detail) : '';
            return (
              <li key={i} className="text-sm text-white/80">
                <span className="font-medium"><InlineMarkdown text={label} /></span>
                {detail ? (
                  <span className="text-white/55"> — <InlineMarkdown text={detail} /></span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const url = str('url');
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-lyo-300 underline">
        {str('caption') ?? str('alt') ?? url}
      </a>
    );
  }

  const text = str('text') ?? str('title') ?? str('source');
  if (text) {
    return (
      <div className="prose-invert prose-sm max-w-none">
        <ReactMarkdown components={markdownComponents} {...MARKDOWN_MATH_PLUGINS}>
          {normalizeLatexDelimiters(text)}
        </ReactMarkdown>
      </div>
    );
  }

  // Genuinely nothing displayable — better an empty gap than raw JSON.
  return null;
}

export default function BlockRenderer({
  blocks,
  message,
}: {
  blocks: ChatBlock[];
  message: ChatMessage;
}) {
  if (!blocks?.length) return null;

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block) => {
        switch (block.type) {
          case 'text':
            return block.subtype === 'callout' ? (
              <CalloutBlock key={block.id} block={block} />
            ) : (
              <TextBlock key={block.id} block={block} />
            );
          case 'dataViz':
            return <DataVizBlock key={block.id} block={block} />;
          case 'quiz':
            return <CheckBlock key={block.id} block={block} message={message} />;
          case 'interactive':
            // A subtype this client does not know still reaches GenericBlock,
            // so an explorable is an upgrade rather than a gate.
            return block.subtype === 'explorable' ? (
              <ExplorableBlock key={block.id} block={block} />
            ) : (
              <GenericBlock key={block.id} block={block} />
            );
          case 'unknown':
            // Forward compatibility: a type this client genuinely does not
            // know is skipped, never rendered as raw JSON and never thrown on.
            return null;
          default:
            // A DECLARED type without a bespoke renderer still gets shown.
            return <GenericBlock key={block.id} block={block} />;
        }
      })}
    </div>
  );
}
