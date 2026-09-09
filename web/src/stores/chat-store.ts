import { create } from 'zustand';
import toast from 'react-hot-toast';
import type {
  ChatMessage,
  ChatConversation,
  ChatAttachment,
  ChatBlock,
  CheckAnswerResult,
  SessionSummary,
  DueReviewItem,
} from '@/types';
import { generateId } from '@/lib/utils';
import { api } from '@/lib/api';
import { parseCanonicalChatContent } from '@/lib/chat-attachments';

export type GenerationActivity = 'thinking' | 'response' | 'course';

/**
 * Pull CTA labels out of an `actions` SSE event.
 *
 * The backend sends `{type:'actions', blocks:[{type:'CTARow',
 * content:{actions:[...]}}]}`. Web dropped this event entirely, so
 * server-suggested follow-ups never rendered.
 */
/**
 * Recover previously graded check verdicts from persisted block metadata.
 *
 * The server writes the verdict onto the block when it grades, so a reloaded
 * conversation can show an answered check as answered rather than re-offering
 * it and losing the learner's selection.
 */
function extractCheckResults(blocks: ChatBlock[]): Record<string, CheckAnswerResult> | undefined {
  const results: Record<string, CheckAnswerResult> = {};
  for (const block of blocks) {
    const stored = block?.metadata?.result;
    if (stored && typeof stored === 'object' && 'correct' in (stored as object)) {
      results[block.id] = stored as CheckAnswerResult;
    }
  }
  return Object.keys(results).length > 0 ? results : undefined;
}

function extractActionLabels(chunk: Record<string, unknown>): string[] {
  const blocks = Array.isArray(chunk.blocks) ? chunk.blocks : [];
  const labels: string[] = [];
  for (const block of blocks) {
    const actions = (block as { content?: { actions?: unknown } })?.content?.actions;
    if (Array.isArray(actions)) {
      labels.push(...actions.filter((a): a is string => typeof a === 'string'));
    }
  }
  return labels;
}

// Module-scoped, not store state: this must survive ChatInterface
// remounting (tabbing away and back within the same app session) but reset
// to false whenever the app is actually reopened — a fresh page load/PWA
// launch re-evaluates this module from scratch, which is exactly the
// "was the app closed" signal ChatGPT/Claude-style "always open on a new
// chat" behavior needs. See hydrate() below.
let hasHydratedThisSession = false;

/** The in-flight hydrate(), so concurrent callers await one round trip. */
let hydrationInFlight: Promise<void> | null = null;

// Module-scoped for the same reason as hasHydratedThisSession above:
// fetchDueReviews() replaces `dueReviews` wholesale from the server on
// every call (e.g. ChatInterface remounting when the learner tabs away and
// back), which would otherwise resurrect a chip the learner just tapped
// away — the schedule on the server doesn't move until the learner
// actually answers a fresh check for that skill. A dismissal only needs to
// survive the current app session, not a real reload.
const dismissedDueReviewSkillIds = new Set<string>();

// Module-scoped identity for "the current new-chat screen", separate from
// activeConversationId. sendMessage() promotes a fresh conversation's
// device-local id to a server-assigned one (see below) partway through
// sending the first message on it — activeConversationId legitimately
// changes at that point even though it's still the exact same screen.
// fetchSessionSummary's staleness guard needs to survive that promotion, so
// it compares against this generation counter (bumped only on a real
// navigation away — a new "new chat", loading a different conversation, or
// the active conversation being deleted) rather than against
// activeConversationId directly.
let newChatScreenGeneration = 0;

interface ChatStore {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  isGenerating: boolean;
  generationProgress: number;
  generationActivity: GenerationActivity;
  isHydrating: boolean;
  // Session-close recap of the conversation just left behind, and the
  // spaced-repetition items due for another look. Both null/empty until
  // fetched — see fetchSessionSummary / fetchDueReviews below.
  sessionSummary: SessionSummary | null;
  dueReviews: DueReviewItem[];

  createConversation: () => string;
  setActiveConversation: (id: string | null) => void;
  hydrate: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  answerCheck: (
    messageId: string,
    blockId: string,
    selectedIndex: number,
    timeTakenMs?: number,
    hintUsed?: boolean
  ) => Promise<CheckAnswerResult | null>;
  deleteConversation: (id: string) => void;
  getActiveConversation: () => ChatConversation | undefined;
  fetchSessionSummary: (conversationId: string, forScreenGeneration: number) => Promise<void>;
  dismissSessionSummary: () => void;
  fetchDueReviews: () => Promise<void>;
  dismissDueReview: (skillId: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  isGenerating: false,
  generationProgress: 0,
  generationActivity: 'thinking',
  isHydrating: false,
  sessionSummary: null,
  dueReviews: [],

  createConversation: () => {
    const state = get();
    const previous = state.conversations.find((c) => c.id === state.activeConversationId);
    // "Session close" = leaving a synced conversation that had at least one
    // graded check to start a new one — the same trigger that already
    // decides when a fresh chat opens (see hydrate()'s ChatGPT/Claude-style
    // note). A local-only conversation was never sent to the server, so
    // there is nothing for the summary endpoint to read.
    const hadAnsweredCheck = previous?.messages.some(
      (m) => m.checkResults && Object.keys(m.checkResults).length > 0
    );

    const id = `local-${generateId()}`;
    const convo: ChatConversation = {
      id,
      title: 'New Chat',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // A genuinely new screen — invalidate any recap fetch still in flight
    // for whatever new-chat screen preceded this one.
    const myScreenGeneration = ++newChatScreenGeneration;
    set((state) => ({
      conversations: [convo, ...state.conversations],
      activeConversationId: id,
      // Starting a fresh chat retires whatever recap was on screen — a
      // stale card from an earlier session must not linger on this new,
      // unrelated one while fetchSessionSummary (below) loads its own.
      sessionSummary: null,
    }));

    if (previous && hadAnsweredCheck && !previous.id.startsWith('local-')) {
      get().fetchSessionSummary(previous.id, myScreenGeneration);
    }

    return id;
  },

  setActiveConversation: (id) => {
    newChatScreenGeneration++;
    set({ activeConversationId: id });
  },

  hydrate: async () => {
    // Concurrent callers await the same work instead of returning early.
    // The early return was fine while every caller only wanted hydration to
    // have been *started*, but a caller that must act **after** it — the
    // seeded opening turn in ChatInterface — would be released while the
    // first call was still in flight. A fresh load ends hydrate() by
    // replacing the conversation list, clearing the active id and opening a
    // new chat, so a turn sent before that lands in a conversation that is
    // then discarded.
    if (hydrationInFlight) return hydrationInFlight;
    hydrationInFlight = (async () => {
      set({ isHydrating: true });
      try {
        const result = await api.chat.conversations();
        const conversations: ChatConversation[] = result.conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          messages: [],
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
        }));

        if (hasHydratedThisSession) {
          // hydrate() runs again every time ChatInterface remounts (e.g. the
          // learner tabs away to Community and back) — that must not disturb
          // whatever conversation is currently open, only refresh the
          // sidebar's history list. A not-yet-synced "New Chat" (a local-
          // only id, absent from the server's list) is kept in front of it.
          const active = get().conversations.find((c) => c.id === get().activeConversationId);
          set({
            conversations: active?.id.startsWith('local-') ? [active, ...conversations] : conversations,
            isHydrating: false,
          });
          return;
        }
        hasHydratedThisSession = true;

        // The first hydrate since the app was actually opened (a fresh page
        // load — reopening a closed tab/PWA re-runs this module from
        // scratch): behave like ChatGPT/Claude and land on a brand-new
        // conversation rather than silently resuming whatever was last open.
        // Nothing is deleted — every past conversation is fetched above and
        // stays one click away in the sidebar.
        set({ conversations, activeConversationId: null, isHydrating: false });
        get().createConversation();
      } catch {
        set({ isHydrating: false });
      }
    })();
    try {
      await hydrationInFlight;
    } finally {
      hydrationInFlight = null;
    }
  },

  loadConversation: async (id) => {
    // Switching conversations — a real navigation away from whatever
    // new-chat screen was previously active. See newChatScreenGeneration.
    // Re-selecting the conversation that's already active (the sidebar
    // re-clicking the current chat, or recoverCanonicalConversation
    // reloading the same id after a stream error) is not a navigation —
    // bumping here would fail an in-flight fetchSessionSummary for this
    // very screen and the recap would never show.
    if (get().activeConversationId !== id) newChatScreenGeneration++;
    if (id.startsWith('local-')) {
      set({ activeConversationId: id });
      return;
    }
    const detail = await api.chat.conversation(id);
    const messages: ChatMessage[] = detail.messages.map((message) => {
      const parsed = message.role === 'user'
        ? parseCanonicalChatContent(message.content)
        : { text: message.content, attachments: [] };
      // Restore structured lesson blocks. Without this a reloaded lesson
      // collapses to the plain-text fallback and its check stops being
      // answerable.
      const blocks = Array.isArray(message.blocks) ? message.blocks : undefined;
      // Graded verdicts ride on the block metadata, so an already-answered
      // check stays answered instead of being offered again after a reload.
      const checkResults = blocks ? extractCheckResults(blocks) : undefined;
      return {
        id: message.id,
        role: message.role,
        content: parsed.text,
        type: 'text',
        blocks,
        checkResults,
        attachments: parsed.attachments,
        createdAt: message.created_at,
      };
    });
    set((state) => ({
      activeConversationId: id,
      conversations: state.conversations.map((conversation) =>
        conversation.id === id
          ? {
              ...conversation,
              title: detail.title,
              messages,
              createdAt: detail.created_at,
              updatedAt: detail.updated_at,
            }
          : conversation
      ),
    }));
  },

  sendMessage: async (content: string, attachments: ChatAttachment[] = []) => {
    const state = get();
    let convoId = state.activeConversationId;
    const trimmedContent = content.trim();
    const titleSeed = trimmedContent || attachments[0]?.name || 'New Chat';

    if (!convoId) {
      convoId = get().createConversation();
    }

    if (convoId.startsWith('local-')) {
      const localId = convoId;
      try {
        const remote = await api.chat.createConversation(titleSeed.slice(0, 80));
        convoId = remote.id;
        set((current) => ({
          activeConversationId: remote.id,
          conversations: current.conversations.map((conversation) =>
            conversation.id === localId
              ? {
                  ...conversation,
                  id: remote.id,
                  title: remote.title,
                  createdAt: remote.created_at,
                  updatedAt: remote.updated_at,
                }
              : conversation
          ),
        }));
      } catch {
        // Never fail the send silently: keep the device-local thread so the
        // user's message renders, and let the stream (or its error toast)
        // take it from here.
        toast.error("Couldn't sync this chat to your account—retrying with a local copy.");
        convoId = localId;
      }
    }

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: trimmedContent,
      type: 'text',
      attachments,
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convoId
          ? {
              ...c,
              title: c.messages.length === 0 ? titleSeed.slice(0, 50) : c.title,
              messages: [...c.messages, userMessage],
              updatedAt: new Date().toISOString(),
            }
          : c
      ),
      isGenerating: true,
      generationProgress: 10,
      generationActivity: 'thinking',
    }));

    // The server is the source of truth for history. Sending only the current
    // conversation ID prevents stale or truncated device-local context.
    const history = undefined;

    const aiMessageId = generateId();
    let accumulated = '';

    // True once anything renderable has arrived — prose OR structured blocks.
    // `accumulated` alone is not a sufficient signal now that a turn can carry
    // its whole answer in blocks.
    let receivedContent = false;

    const appendToAiMessage = (text: string) => {
      accumulated += text;
      receivedContent = true;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convoId) return c;
          const existing = c.messages.find((m) => m.id === aiMessageId);
          if (existing) {
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === aiMessageId ? { ...m, content: accumulated } : m
              ),
              updatedAt: new Date().toISOString(),
            };
          }
          return {
            ...c,
            messages: [
              ...c.messages,
              {
                id: aiMessageId,
                role: 'assistant' as const,
                content: accumulated,
                type: 'text' as const,
                createdAt: new Date().toISOString(),
              },
            ],
            updatedAt: new Date().toISOString(),
          };
        }),
        generationProgress: Math.min(90, get().generationProgress + 5),
        generationActivity: s.generationActivity === 'course' ? 'course' : 'response',
      }));
    };

    // Merge a patch into the streaming assistant message, creating it if the
    // structured event arrived before any text did.
    const patchAiMessage = (patch: Partial<ChatMessage>) => {
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convoId) return c;
          const existing = c.messages.find((m) => m.id === aiMessageId);
          if (existing) {
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === aiMessageId ? { ...m, ...patch } : m
              ),
              updatedAt: new Date().toISOString(),
            };
          }
          return {
            ...c,
            messages: [
              ...c.messages,
              {
                id: aiMessageId,
                role: 'assistant' as const,
                content: accumulated,
                type: 'text' as const,
                createdAt: new Date().toISOString(),
                ...patch,
              },
            ],
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
    };

    const attachBlocksToAiMessage = (blocks: ChatBlock[]) => {
      // Blocks are real content. Without this, a lesson delivered purely as
      // blocks looks like an empty response to the completion handler below
      // and gets wiped by the recovery path.
      receivedContent = true;
      patchAiMessage({ blocks });
    };
    const attachActionsToAiMessage = (labels: string[]) => {
      // Same reason as blocks: a turn that produced only follow-up chips is
      // still a real turn, and must not be wiped as an empty response.
      receivedContent = true;
      patchAiMessage({ suggestedActions: labels });
    };

    try {
      api.chat.stream(
        trimmedContent,
        history,
        (chunk) => {
          const block = chunk.block as Record<string, unknown> | undefined;
          const blockContent = block?.content as Record<string, unknown> | undefined;
          if (chunk.type === 'answer' || chunk.type === 'text') {
            const text = blockContent?.text as string
              || (chunk.payload as Record<string, unknown>)?.text as string
              || (chunk.content as string)
              || '';
            if (text) appendToAiMessage(text);
          } else if (chunk.type === 'clarification' && typeof chunk.text === 'string') {
            appendToAiMessage(chunk.text);
          } else if (chunk.type === 'open_classroom') {
            const classroomBlock = chunk.block as { content?: Record<string, any> } | undefined;
            const courseData = (classroomBlock?.content?.course || classroomBlock?.content) as
              Record<string, any> | undefined;
            if (courseData) {
              // Normalize difficulty
              if (courseData.difficulty) {
                courseData.difficulty = courseData.difficulty.toLowerCase();
              }
              // Normalize duration string/number
              const rawDuration = courseData.estimated_duration || courseData.duration;
              let sanitizedDuration = 60; // fallback to 60 mins
              if (typeof rawDuration === 'number') {
                sanitizedDuration = rawDuration;
              } else if (typeof rawDuration === 'string') {
                const numMatch = rawDuration.match(/\d+/);
                if (numMatch) {
                  const num = parseInt(numMatch[0]);
                  if (rawDuration.toLowerCase().includes('hour')) {
                    sanitizedDuration = num * 60;
                  } else {
                    sanitizedDuration = num;
                  }
                }
              }
              courseData.estimatedDuration = sanitizedDuration;

              // Normalize lessons to modules
              if (!courseData.modules && courseData.lessons) {
                courseData.modules = courseData.lessons.map((lesson: any, index: number) => ({
                  id: lesson.id || `l-${index}`,
                  title: lesson.title,
                  description: lesson.description || '',
                  order: index + 1,
                  lessons: [lesson]
                }));
              }

              set((s) => ({
                generationActivity: 'course',
                conversations: s.conversations.map((c) => {
                  if (c.id !== convoId) return c;
                  const existing = c.messages.find((m) => m.id === aiMessageId);
                  if (existing) {
                    return {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === aiMessageId
                          ? {
                              ...m,
                              type: 'course_proposal' as const,
                              metadata: { ...m.metadata, course: courseData },
                            }
                          : m
                      ),
                      updatedAt: new Date().toISOString(),
                    };
                  }
                  return {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: aiMessageId,
                        role: 'assistant' as const,
                        content: '',
                        type: 'course_proposal' as const,
                        metadata: { course: courseData },
                        createdAt: new Date().toISOString(),
                      },
                    ],
                    updatedAt: new Date().toISOString(),
                  };
                }),
              }));
            }
          } else if (chunk.type === 'smart_blocks') {
            // Structured lesson content. Previously fell through every branch
            // and was silently dropped, so lessons rendered as plain prose.
            const blocks = Array.isArray(chunk.blocks) ? (chunk.blocks as ChatBlock[]) : [];
            if (blocks.length) attachBlocksToAiMessage(blocks);
          } else if (chunk.type === 'actions') {
            const labels = extractActionLabels(chunk);
            if (labels.length) attachActionsToAiMessage(labels);
          } else if (chunk.data) {
            const text = typeof chunk.data === 'string' ? chunk.data : '';
            if (text) appendToAiMessage(text);
          } else if (typeof chunk === 'object' && chunk.content) {
            appendToAiMessage(chunk.content as string);
          }
        },
        () => {
          if (!receivedContent) {
            recoverCanonicalConversation(convoId!);
          } else {
            set({
              isGenerating: false,
              generationProgress: 0,
              generationActivity: 'thinking',
            });
          }
        },
        () => {
          recoverCanonicalConversation(convoId!);
        },
        convoId,
        userMessage.id,
        attachments.map((attachment) => ({
          modality: attachment.kind === 'image' ? 'IMAGE' as const : 'DOCUMENT' as const,
          uri: attachment.url,
          mime_type: attachment.mimeType,
          name: attachment.name,
          size_bytes: attachment.size,
        }))
      );
    } catch {
      recoverCanonicalConversation(convoId!);
    }

    async function recoverCanonicalConversation(cId: string) {
      set({
        isGenerating: false,
        generationProgress: 0,
        generationActivity: 'thinking',
      });
      try {
        // A broken SSE connection does not imply the server failed. Reload the
        // canonical thread so a completed answer is recovered without creating
        // a second, device-only response.
        await get().loadConversation(cId);
      } catch {
        // Preserve the optimistic user turn until the next successful hydrate.
      }
      toast.error('The response was interrupted. Your conversation is saved—please retry.');
    }
  },

  answerCheck: async (messageId, blockId, selectedIndex, timeTakenMs = 0, hintUsed = false) => {
    const conversationId = get().activeConversationId;
    // A check on a not-yet-synced local conversation has nothing to grade
    // against server-side.
    if (!conversationId || conversationId.startsWith('local-')) {
      toast.error("This chat isn't synced yet—send a message first.");
      return null;
    }

    try {
      const result = await api.chat.checkAnswer({
        conversationId,
        blockId,
        selectedIndex,
        timeTakenMs,
        // Feeds LearnerMastery.hints_used, which damps the mastery gain — an
        // assisted answer recorded as unassisted overstates what was learned.
        hintUsed,
      });

      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        checkResults: { ...(message.checkResults || {}), [blockId]: result },
                      }
                    : message
                ),
              }
            : conversation
        ),
      }));

      return result;
    } catch {
      // Never fake a verdict on the client: say we couldn't check rather than
      // guessing, which is the whole failure mode this feature exists to fix.
      toast.error("Couldn't check that answer—try again.");
      return null;
    }
  },

  deleteConversation: (id) => {
    if (!id.startsWith('local-')) api.chat.deleteConversation(id).catch(() => {});
    set((state) => {
      // Deleting the active screen is a real navigation away from it too.
      if (state.activeConversationId === id) newChatScreenGeneration++;
      return {
        conversations: state.conversations.filter((c) => c.id !== id),
        activeConversationId:
          state.activeConversationId === id ? null : state.activeConversationId,
      };
    });
  },

  getActiveConversation: () => {
    const state = get();
    return state.conversations.find(
      (c) => c.id === state.activeConversationId
    );
  },

  fetchSessionSummary: async (conversationId, forScreenGeneration) => {
    try {
      const summary = await api.chat.sessionSummary(conversationId);
      // Stale guard: if the learner has already moved past the empty chat
      // this recap was meant for — started yet another new chat, or
      // switched to a different conversation entirely — while the request
      // was in flight, applying it now would attach the wrong session's
      // recap to whatever screen happens to be open. Compared against the
      // screen generation rather than activeConversationId directly: the
      // latter also changes when sendMessage promotes this same screen's
      // device-local id to a server-assigned one, which must NOT count as
      // "moved on" — the recap still belongs on that screen.
      if (newChatScreenGeneration !== forScreenGeneration) return;
      // Nothing was graded in that conversation — a recap with nothing to
      // say is not worth interrupting the new chat for.
      if (summary.nailed.length > 0 || summary.shaky.length > 0) {
        set({ sessionSummary: summary });
      }
    } catch {
      // Best-effort: a recap that fails to load must never block starting
      // (or using) a new conversation.
    }
  },

  dismissSessionSummary: () => set({ sessionSummary: null }),

  fetchDueReviews: async () => {
    try {
      const { items } = await api.chat.dueReviews();
      set({
        dueReviews: items.filter((item) => !dismissedDueReviewSkillIds.has(item.skill_id)),
      });
    } catch {
      // Best-effort — same reasoning as fetchSessionSummary.
    }
  },

  dismissDueReview: (skillId) => {
    dismissedDueReviewSkillIds.add(skillId);
    set((state) => ({
      dueReviews: state.dueReviews.filter((item) => item.skill_id !== skillId),
    }));
  },
}));

