import { canRenderExplorable } from '@/lib/explorable.mjs';
import type { ChatBlock } from '@/types';

/**
 * Whether BlockRenderer will actually display something for this block.
 *
 * MessageBubble uses this to decide if it can hide the plain-text fallback.
 * That makes it load-bearing: if this says "yes" and the renderer then bails
 * on a missing field, the turn shows an empty bubble and the prose version of
 * the same content is lost.
 *
 * So each branch mirrors exactly what the corresponding renderer requires —
 * a heuristic like "any non-empty content field" is not good enough, because
 * a dataViz block with only a `title`, or a quiz carrying `correct_index: 0`
 * but no question, would pass it and still render nothing.
 *
 * Lives in its own JSX-free module so it can be unit-tested directly.
 */
export function canRenderBlock(block: ChatBlock | null | undefined): boolean {
  if (!block || block.type === 'unknown') return false;

  const content = (block.content ?? {}) as Record<string, unknown>;
  const str = (key: string) =>
    typeof content[key] === 'string' && (content[key] as string).length > 0;

  switch (block.type) {
    // TextBlock / CalloutBlock both render content.text.
    case 'text':
      return str('text');

    // DataVizBlock returns null without a source, whatever the format.
    case 'dataViz':
      return str('source');

    // CheckBlock needs a question AND options to be answerable.
    case 'quiz':
      return (
        str('question') && Array.isArray(content.options) && content.options.length > 0
      );

    // Delegated, not re-implemented. This branch previously accepted any
    // string `kind`, while ExplorableBlock draws only the kinds it knows — so
    // an unrecognised or future kind passed here, MessageBubble hid the prose
    // fallback on the strength of it, and the component then rendered
    // nothing. The learner got a gap where the lesson used to be.
    //
    // Any other interactive subtype reaches GenericBlock, so it is judged by
    // the same chain as the default case — not by falling out of the switch,
    // which would return undefined and hide the fallback just as quietly.
    case 'interactive':
      return block.subtype === 'explorable'
        ? canRenderExplorable(content)
        : genericChain(str, content);

    // Mirrors GenericBlock's fallback chain, in the same order.
    default:
      return genericChain(str, content);
  }
}

/** GenericBlock's fallback chain, in the same order it tries them. */
function genericChain(
  str: (key: string) => boolean,
  content: Record<string, unknown>
): boolean {
  return (
    str('code') ||
    str('front') ||
    (typeof content.completed === 'number' && typeof content.total === 'number') ||
    (Array.isArray(content.items) && content.items.length > 0) ||
    str('url') ||
    str('text') ||
    str('title') ||
    str('source')
  );
}
