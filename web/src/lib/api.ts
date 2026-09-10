import type {
  User,
  ChatBlock,
  ConceptSummary,
  RecommendationList,
  CheckAnswerResult,
  SessionSummary,
  DueReviewItem,
  LearningNode,
  LearningNodeCategory,
  LearningNodeKind,
  MyCommunityResponse,
  NearbyLearningResponse,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.lyoai.app';

// The backend stores this as session_id, a VARCHAR(64); older builds wrote
// 40-char "web-<uuid>" ids to localStorage, so clamp on read as well.
const MAX_DEVICE_ID_LENGTH = 36;

function getOrCreateChatDeviceId(): string {
  if (typeof window === 'undefined') return 'web-server';
  const key = 'lyo_chat_device_id';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing.slice(0, MAX_DEVICE_ID_LENGTH);
  const id = `web-${crypto.randomUUID()}`.slice(0, MAX_DEVICE_ID_LENGTH);
  window.localStorage.setItem(key, id);
  return id;
}

// ── Token management ─────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('lyo_token');
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('lyo_refresh_token');
}

export function setTokens(access: string, refresh?: string | null) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('lyo_token', access);
  if (refresh) localStorage.setItem('lyo_refresh_token', refresh);
}

export function clearTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('lyo_token');
  localStorage.removeItem('lyo_refresh_token');
}

// ── Core request ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * `skipAuth` sends no token at all — for genuinely public endpoints.
 *
 * `optionalAuth` still sends the token when there is one, but a 401 throws
 * instead of clearing the session and navigating to /auth/login. Use it for
 * anything supplementary: a signed-out visitor has no learner record, and a
 * call that merely *decorates* Home must never be able to evict them from it.
 * The front door is supposed to work for guests.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit & { skipAuth?: boolean; optionalAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, optionalAuth, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (res.status === 401 && !skipAuth) {
    // The refresh runs for optional calls too. Skipping the whole branch was
    // an over-correction: a signed-in learner with a merely *expired* access
    // token would never refresh on these, so the concept headline and Next
    // for you would sit empty for the whole visit — `useApi` does not retry
    // after some other request later refreshes the token.
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getAccessToken()}`;
      const retry = await fetch(`${API_URL}${endpoint}`, {
        ...fetchOptions,
        headers,
      });
      if (retry.ok) {
        if (retry.status === 204) return undefined as T;
        return retry.json();
      }
    }

    // What `optionalAuth` actually buys: the refresh was tried and failed, or
    // there was never a session. For a supplementary call that means "no data
    // for you", not "you are logged out" — so it throws for the caller to
    // swallow rather than clearing the session and navigating away from the
    // front door a guest is standing in.
    if (optionalAuth) {
      throw new ApiError('Not signed in', 401);
    }

    clearTokens();
    if (typeof window !== 'undefined') window.location.href = '/auth/login';
    throw new ApiError('Session expired', 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new ApiError(body.detail || body.message || `HTTP ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function tryRefreshToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// ── Adapters (backend → frontend types) ──────────────────────────────────────

export function adaptUser(raw: Record<string, unknown>): User {
  const firstName = (raw.first_name as string) || '';
  const lastName = (raw.last_name as string) || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || (raw.username as string) || 'User';

  return {
    id: String(raw.id ?? ''),
    email: (raw.email as string) || '',
    displayName,
    username: (raw.username as string) || '',
    avatar: (raw.avatar_url as string) || '',
    bio: (raw.bio as string) || '',
    role: 'student',
    interests: (raw.interests as string[]) || [],
    learningGoals: (raw.learning_goals as string[]) || [],
    streak: (raw.streak as number) || 0,
    xp: (raw.xp as number) || (raw.total_xp as number) || 0,
    level: (raw.level as number) || (raw.current_level as number) || 1,
    coursesCompleted: (raw.courses_completed as number) || 0,
    followersCount: (raw.followers_count as number) || 0,
    followingCount: (raw.following_count as number) || 0,
    createdAt: (raw.created_at as string) || new Date().toISOString(),
    isPremium: (raw.is_premium as boolean) || false,
  };
}

// ── API methods ──────────────────────────────────────────────────────────────

export const api = {
  // ── Auth ──
  auth: {
    async login(email: string, password: string) {
      const data = await request<{
        user: Record<string, unknown>;
        access_token: string;
        refresh_token?: string;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      });
      setTokens(data.access_token, data.refresh_token);
      return { user: adaptUser(data.user), accessToken: data.access_token };
    },

    async register(params: {
      email: string;
      username: string;
      password: string;
      confirmPassword: string;
      firstName?: string;
      lastName?: string;
    }) {
      const data = await request<{
        user: Record<string, unknown>;
        access_token: string;
        refresh_token?: string;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: params.email,
          username: params.username,
          password: params.password,
          confirm_password: params.confirmPassword,
          first_name: params.firstName,
          last_name: params.lastName,
        }),
        skipAuth: true,
      });
      setTokens(data.access_token, data.refresh_token);
      return { user: adaptUser(data.user), accessToken: data.access_token };
    },

    async me() {
      const data = await request<Record<string, unknown>>('/auth/me');
      return adaptUser(data);
    },

    async updateProfile(updates: { full_name?: string; bio?: string; avatar_url?: string }) {
      const data = await request<Record<string, unknown>>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      return adaptUser(data);
    },

    async logout() {
      try {
        await request('/auth/logout', { method: 'POST' });
      } finally {
        clearTokens();
      }
    },
  },

  // ── AI Chat ──
  chat: {
    async conversations() {
      return request<{
        conversations: Array<{
          id: string;
          title: string;
          message_count: number;
          last_message_preview?: string;
          current_mode: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }>;
        has_more: boolean;
      }>('/api/v1/chat/conversations');
    },

    async conversation(id: string) {
      return request<{
        id: string;
        title: string;
        created_at: string;
        updated_at: string;
        messages: Array<{
          id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          created_at: string;
          // Structured lesson blocks, when the turn carried them. Restored on
          // reload so a lesson does not collapse into plain text.
          blocks?: ChatBlock[] | null;
        }>;
      }>(`/api/v1/chat/conversations/${id}`);
    },

    async createConversation(title?: string) {
      return request<{
        id: string;
        title: string;
        created_at: string;
        updated_at: string;
        messages: [];
      }>('/api/v1/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title,
          device_id: getOrCreateChatDeviceId(),
        }),
      });
    },

    async deleteConversation(id: string) {
      return request<void>(`/api/v1/chat/conversations/${id}`, { method: 'DELETE' });
    },

    async send(text: string, history?: { role: string; content: string }[]) {
      return request<{ answer_block: unknown; metadata: unknown }>('/api/v1/lyo2/chat', {
        method: 'POST',
        body: JSON.stringify({ text, history }),
      });
    },

    /**
     * Submit an answer to an in-chat check.
     *
     * Sends only WHICH option was picked. Correctness is decided server-side
     * from the block the server itself emitted — the client never grades, and
     * never trusts `correct_index` off the wire for that purpose.
     */
    async checkAnswer(params: {
      conversationId: string;
      blockId: string;
      selectedIndex: number;
      timeTakenMs?: number;
      hintUsed?: boolean;
    }) {
      return request<CheckAnswerResult>('/api/v1/lyo2/chat/check', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: params.conversationId,
          block_id: params.blockId,
          selected_index: params.selectedIndex,
          time_taken_ms: params.timeTakenMs ?? 0,
          hint_used: params.hintUsed ?? false,
        }),
      });
    },

    /**
     * Session-close recap: what a conversation's answered checks show the
     * learner nailed vs. what's still shaky. Read-only — built entirely from
     * data `checkAnswer` above already caused the server to write.
     */
    async sessionSummary(conversationId: string) {
      return request<SessionSummary>(`/api/v1/lyo2/chat/${conversationId}/summary`);
    },

    /**
     * Skills whose spaced-repetition schedule says they're due for another
     * look — the return half of the loop `checkAnswer` silently feeds every
     * time a check is graded.
     */
    async dueReviews() {
      return request<{ items: DueReviewItem[] }>('/api/v1/lyo2/chat/reviews/due');
    },

    stream(
      text: string,
      history: { role: string; content: string }[] | undefined,
      onChunk: (data: Record<string, unknown>) => void,
      onDone: () => void,
      onError: (err: Error) => void,
      conversationId?: string,
      clientMessageId?: string,
      media?: Array<{
        modality: 'IMAGE' | 'DOCUMENT';
        uri: string;
        mime_type: string;
        name: string;
        size_bytes: number;
      }>
    ): AbortController {
      const controller = new AbortController();

      const doFetch = (authToken: string | null) =>
        fetch(`${API_URL}/api/v1/lyo2/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            text,
            conversation_id: conversationId,
            conversation_history: history,
            device_id: getOrCreateChatDeviceId(),
            client_message_id: clientMessageId,
            media,
          }),
          signal: controller.signal,
        });

      const readStream = async (res: Response) => {
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') {
              onDone();
              return;
            }
            try {
              onChunk(JSON.parse(payload));
            } catch {
              // skip malformed JSON
            }
          }
        }
        onDone();
      };

      (async () => {
        try {
          let res = await doFetch(getAccessToken());
          // Unlike request()'s generic wrapper, this raw fetch had no 401
          // retry — once an access token expired, every chat message failed
          // silently into the "response was interrupted" recovery path,
          // forever, until the user logged out and back in. Refresh once,
          // exactly like request() already does.
          if (res.status === 401) {
            const refreshed = await tryRefreshToken();
            if (refreshed) {
              res = await doFetch(getAccessToken());
            }
          }
          if (!res.ok) throw new Error(`Stream failed: ${res.status}`);
          await readStream(res);
        } catch (err) {
          if ((err as Error).name !== 'AbortError') onError(err as Error);
        }
      })();

      return controller;
    },

    async sendSimple(message: string, provider?: string) {
      return request<{ response: string; suggestions?: { text: string }[] }>('/api/v1/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message, provider: provider || 'gemini' }),
      });
    },
  },

  // ── Feed / Community ──
  feed: {
    async list(page = 1, perPage = 20) {
      return request<{ posts: Record<string, unknown>[]; total: number; page: number }>(
        `/feed?page=${page}&per_page=${perPage}`
      );
    },

    async publicFeed(page = 1, perPage = 20) {
      return request<{ posts: Record<string, unknown>[]; total: number }>(
        `/feed/public?page=${page}&per_page=${perPage}`
      );
    },

    async get(postId: string) {
      return request<Record<string, unknown>>(`/posts/${postId}`);
    },

    async create(content: string, mediaUrls?: string[]) {
      return request<Record<string, unknown>>('/posts', {
        method: 'POST',
        body: JSON.stringify({
          content,
          post_type: mediaUrls && mediaUrls.length > 0 ? 'image' : 'text',
          image_url: mediaUrls?.[0],
        }),
      });
    },

    async like(postId: string) {
      return request('/posts/' + postId + '/reactions', {
        method: 'POST',
        body: JSON.stringify({ post_id: Number(postId), reaction_type: 'like' }),
      });
    },

    async unlike(postId: string) {
      return request(`/posts/${postId}/reactions`, { method: 'DELETE' });
    },

    async comment(postId: string, content: string) {
      return request<Record<string, unknown>>('/comments', {
        method: 'POST',
        body: JSON.stringify({ post_id: Number(postId), content }),
      });
    },

    async deleteComment(commentId: string) {
      return request(`/comments/${commentId}`, { method: 'DELETE' });
    },
  },

  // ── Users ──
  users: {
    async get(userId: string) {
      const data = await request<Record<string, unknown>>(`/auth/users/${userId}`);
      return adaptUser(data);
    },

    async posts(userId: string, page = 1) {
      return request<{ posts: Record<string, unknown>[]; total: number }>(
        `/users/${userId}/posts?page=${page}`
      );
    },

    async stats(userId: string) {
      return request<Record<string, unknown>>(`/users/${userId}/stats`);
    },

    async follow(userId: string) {
      return request('/follow', {
        method: 'POST',
        body: JSON.stringify({ following_id: Number(userId) }),
      });
    },

    async unfollow(userId: string) {
      return request(`/follow/${userId}`, { method: 'DELETE' });
    },
  },

  // ── Courses ──
  courses: {
    async list(skip = 0, limit = 20, subject?: string, difficulty?: string) {
      const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
      if (subject) params.set('subject', subject);
      if (difficulty) params.set('difficulty', difficulty);
      return request<Record<string, unknown>[]>(`/api/v1/learning/courses?${params}`);
    },

    async get(courseId: string) {
      return request<Record<string, unknown>>(`/api/v1/learning/courses/${courseId}`);
    },

    async create(data: Record<string, unknown>) {
      return request<Record<string, unknown>>('/api/v1/learning/courses', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async generate(topic: string, difficulty = 'beginner', durationHours = 2) {
      return request<{ task_id: string; status: string }>('/api/v1/learning/courses/generate', {
        method: 'POST',
        body: JSON.stringify({
          topic,
          difficulty,
          duration_hours: durationHours,
          include_exercises: true,
          include_assessments: true,
        }),
      });
    },
  },

  // ── Clips ──
  clips: {
    async list(page = 1, perPage = 20) {
      return request<{ clips: Record<string, unknown>[]; total: number }>(
        `/api/v1/clips?page=${page}&per_page=${perPage}`
      );
    },

    async discover(page = 1, perPage = 20, subject?: string) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (subject) params.set('subject', subject);
      return request<{ clips: Record<string, unknown>[]; total: number }>(
        `/api/v1/clips/discover?${params}`
      );
    },

    async get(clipId: string) {
      return request<{ clip: Record<string, unknown> }>(`/api/v1/clips/${clipId}`);
    },

    async create(data: Record<string, unknown>) {
      return request<{ clip: Record<string, unknown> }>('/api/v1/clips', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async like(clipId: string) {
      return request<{ isLiked: boolean; likeCount: number }>(`/api/v1/clips/${clipId}/like`, {
        method: 'POST',
      });
    },

    async save(clipId: string) {
      return request<{ isSaved: boolean }>(`/api/v1/clips/${clipId}/save`, {
        method: 'POST',
      });
    },

    async view(clipId: string) {
      return request(`/api/v1/clips/${clipId}/view`, { method: 'POST' });
    },

    async saved(page = 1, perPage = 20) {
      return request<{ clips: Record<string, unknown>[]; total: number }>(
        `/api/v1/clips/saved?page=${page}&per_page=${perPage}`
      );
    },

    async share(clipId: string) {
      return request<{ shareCount: number }>(`/api/v1/clips/${clipId}/share`, {
        method: 'POST',
      });
    },

    async comments(clipId: string, page = 1, perPage = 50) {
      return request<{ items: Record<string, unknown>[]; total_count: number }>(
        `/api/v1/clips/${clipId}/comments?page=${page}&per_page=${perPage}`
      );
    },

    async createComment(clipId: string, content: string) {
      return request<Record<string, unknown>>(`/api/v1/clips/${clipId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
    },

    async deleteComment(clipId: string, commentId: string) {
      return request(`/api/v1/clips/${clipId}/comments/${commentId}`, { method: 'DELETE' });
    },
  },

  // ── Media upload (multipart; chat attachments, reels, and post images) ──
  media: {
    async upload(file: File, folder = 'content') {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', folder);
      const send = () => {
        const headers: Record<string, string> = {};
        const token = getAccessToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(`${API_URL}/api/v1/media/upload`, {
          method: 'POST',
          headers, // no Content-Type — the browser sets the multipart boundary
          body: form,
        });
      };
      let res = await send();
      if (res.status === 401 && await tryRefreshToken()) {
        res = await send();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new ApiError(body.detail || `HTTP ${res.status}`, res.status);
      }
      return res.json() as Promise<{
        success: boolean;
        url: string;
        path: string;
        contentType: string;
        size: number;
      }>;
    },
  },

  // ── Search (users, groups, events, posts) ──
  search: {
    async query(q: string, type: 'all' | 'users' | 'groups' | 'events' | 'posts' = 'all', limit = 10) {
      const params = new URLSearchParams({ q, type, limit: String(limit) });
      return request<{
        query: string;
        users: Array<{ id: number; username: string; name: string; avatar_url: string | null }>;
        groups: Record<string, unknown>[];
        events: Record<string, unknown>[];
        posts: Record<string, unknown>[];
        total: number;
      }>(`/api/v1/search?${params}`);
    },
  },

  // ── Stories ──
  stories: {
    async list() {
      return request<{ stories: Record<string, unknown>[]; my_story?: Record<string, unknown> }>(
        '/api/v1/stories'
      );
    },

    async get(storyId: string) {
      return request<Record<string, unknown>>(`/api/v1/stories/${storyId}`);
    },

    async create(data: { media_url: string; media_type?: string; caption?: string; tags?: string[] }) {
      return request<Record<string, unknown>>('/api/v1/stories', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async seen(storyId: string) {
      return request(`/api/v1/stories/${storyId}/seen`, { method: 'POST' });
    },
  },

  // ── Learning activity ──
  learning: {
    /**
     * Record that the learner engaged with a representation of a concept.
     *
     * This is *exposure* — they met the idea. It is not a demonstration, and
     * this call cannot make it one: the server records any client-submitted
     * event as exposure with no graded outcome, whatever the body claims. A
     * demonstration has to be graded server-side.
     */
    async recordExposure(conceptId: string) {
      return request('/api/v1/evolution/events', {
        // Bookkeeping. A guest clicking a point on a number line is exploring
        // an idea; being thrown to the login page for it would be absurd.
        optionalAuth: true,
        method: 'POST',
        body: JSON.stringify({
          user_id: 0, // replaced server-side by the authenticated user
          event_type: 'AI_SESSION',
          concept_id: conceptId,
          source_surface: 'chat',
        }),
      });
    },
  },

  // ── Learner model ──
  personalization: {
    /**
     * How many concepts this learner is exploring, has learned, retained and
     * mastered — counted server-side from their own evidence, never derived
     * on the client from a score that happens to be handy.
     *
     * Home leads with these. A wrong one is worse than no headline: a learner
     * told they have mastered twelve concepts and then failing a test on them
     * has been lied to by their own progress screen.
     */
    async conceptSummary() {
      return request<ConceptSummary>('/api/v1/personalization/concepts/summary', {
        // Home calls this on every load, including for signed-out visitors.
        // Without this a missing token would redirect them to /auth/login —
        // out of the front door the page exists to show them.
        optionalAuth: true,
      });
    },

    /**
     * What this learner should do next, with the reason attached — drawn from
     * their own review schedule and mastery profile.
     *
     * Empty when there is no basis for a recommendation. Home stays silent in
     * that case rather than filling the space with the catalogue and calling
     * it "for you", which is what this replaced.
     */
    async recommendations(limit = 4) {
      return request<RecommendationList>(
        `/api/v1/personalization/recommendations?limit=${limit}`,
        { optionalAuth: true }
      );
    },
  },

  // ── Gamification ──
  gamification: {
    async overview() {
      return request<Record<string, unknown>>('/gamification/overview');
    },


    async stats() {
      return request<Record<string, unknown>>('/gamification/stats');
    },

    async level() {
      return request<Record<string, unknown>>('/gamification/level');
    },

    async xpSummary() {
      return request<Record<string, unknown>>('/gamification/xp/summary');
    },

    async achievements(completedOnly = false) {
      return request<Record<string, unknown>[]>(
        `/gamification/my-achievements?completed_only=${completedOnly}`
      );
    },

    async streaks() {
      return request<Record<string, unknown>[]>('/gamification/streaks');
    },

    async leaderboard(type = 'xp', period = 'weekly', limit = 20) {
      return request<Record<string, unknown>>(
        `/gamification/leaderboards/${type}?period=${period}&limit=${limit}`
      );
    },
  },

  // ── Messages (DMs) ──
  messages: {
    async conversations() {
      return request<{ conversations: Record<string, unknown>[] }>('/messages/conversations');
    },

    async getMessages(conversationId: string, page = 1) {
      return request<{ messages: Record<string, unknown>[]; total: number }>(
        `/messages/conversations/${conversationId}?page=${page}`
      );
    },

    async createConversation(participantIds: number[]) {
      return request<Record<string, unknown>>('/messages/conversations', {
        method: 'POST',
        body: JSON.stringify({ participant_ids: participantIds }),
      });
    },

    async sendMessage(conversationId: string, content: string) {
      return request<Record<string, unknown>>(
        `/messages/conversations/${conversationId}/messages`,
        { method: 'POST', body: JSON.stringify({ content }) }
      );
    },

    async markRead(conversationId: string) {
      return request('/messages/conversations/' + conversationId + '/read', { method: 'POST' });
    },
  },

  // ── Community (Groups & Events) ──
  community: {
    async nearby(params: {
      latitude: number;
      longitude: number;
      radiusKm?: number;
      categories?: LearningNodeCategory[];
      query?: string;
      includeOnline?: boolean;
      includeInstitutions?: boolean;
      limit?: number;
    }) {
      const query = new URLSearchParams({
        lat: String(params.latitude),
        lng: String(params.longitude),
        radius_km: String(params.radiusKm ?? 15),
        include_online: String(params.includeOnline ?? true),
        include_institutions: String(params.includeInstitutions ?? true),
        limit: String(params.limit ?? 150),
      });
      if (params.categories?.length) query.set('categories', params.categories.join(','));
      if (params.query?.trim()) query.set('q', params.query.trim());
      return request<NearbyLearningResponse>(`/community/nearby?${query}`);
    },

    async me() {
      return request<MyCommunityResponse>('/community/me');
    },

    async saveNode(node: LearningNode) {
      return request<LearningNode>(
        `/community/saved-nodes/${node.kind}/${encodeURIComponent(node.id)}`,
        { method: 'PUT', body: JSON.stringify({ snapshot: node }) },
      );
    },

    async unsaveNode(kind: LearningNodeKind, nodeId: string) {
      return request<void>(
        `/community/saved-nodes/${kind}/${encodeURIComponent(nodeId)}`,
        { method: 'DELETE' },
      );
    },

    async groups() {
      return request<Record<string, unknown>[]>('/community/study-groups');
    },

    async createGroup(payload: {
      name: string;
      description?: string;
      privacy?: 'public' | 'private';
      max_members?: number;
      requires_approval?: boolean;
      location?: string;
      is_online?: boolean;
      meeting_url?: string;
      latitude?: number;
      longitude?: number;
    }) {
      return request<Record<string, unknown>>('/community/study-groups', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async group(groupId: string) {
      return request<Record<string, unknown>>(`/community/study-groups/${groupId}`);
    },

    async joinGroup(groupId: string) {
      return request(`/community/study-groups/${groupId}/join`, { method: 'POST' });
    },

    async leaveGroup(groupId: string) {
      return request(`/community/study-groups/${groupId}/leave`, { method: 'DELETE' });
    },

    async events() {
      return request<Record<string, unknown>[]>('/community/events');
    },

    async createEvent(payload: {
      title: string;
      description?: string;
      event_type: 'study_session' | 'workshop' | 'class' | 'seminar' | 'lecture' | 'discussion' | 'project_showcase' | 'networking' | 'office_hours' | 'other';
      start_time: string;
      end_time: string;
      location?: string;
      is_online?: boolean;
      meeting_url?: string;
      max_attendees?: number;
      timezone: string;
      latitude?: number;
      longitude?: number;
    }) {
      return request<Record<string, unknown>>('/community/events', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async createTutor(payload: {
      title: string;
      description?: string;
      subject: string;
      price_per_hour?: number;
      currency?: string;
      duration_minutes?: number;
      location?: string;
      latitude?: number;
      longitude?: number;
      is_online?: boolean;
      meeting_url?: string;
    }) {
      return request<Record<string, unknown>>('/community/lessons', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async event(eventId: string) {
      return request<Record<string, unknown>>(`/community/events/${eventId}`);
    },

    async attendEvent(eventId: string) {
      return request(`/community/events/${eventId}/attend`, { method: 'POST' });
    },

    async unattendEvent(eventId: string) {
      return request(`/community/events/${eventId}/attend`, { method: 'DELETE' });
    },

    async stats() {
      return request<Record<string, number>>('/community/stats');
    },

    // ── Community posts — the same store iOS renders (community/posts),
    //    NOT the separate /feed store; one account, one feed everywhere. ──
    async posts(page = 1, limit = 20, sortBy: 'recent' | 'popular' | 'trending' = 'recent') {
      return request<{
        items: Record<string, unknown>[];
        page: number;
        limit: number;
        total_count: number;
        total_pages: number;
      }>(`/community/posts?page=${page}&limit=${limit}&sort_by=${sortBy}`);
    },

    async post(postId: string) {
      return request<Record<string, unknown>>(`/community/posts/${postId}`);
    },

    async createPost(payload: {
      content: string;
      tags?: string[];
      media_urls?: string[];
      post_type?: string;
    }) {
      return request<Record<string, unknown>>('/community/posts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async togglePostLike(postId: string) {
      return request<{ liked: boolean; like_count: number }>(
        `/community/posts/${postId}/like`,
        { method: 'POST' }
      );
    },

    async togglePostBookmark(postId: string) {
      return request<{ bookmarked: boolean }>(
        `/community/posts/${postId}/bookmark`,
        { method: 'POST' }
      );
    },

    async comments(postId: string, page = 1, limit = 50) {
      return request<{ items: Record<string, unknown>[]; total_count: number }>(
        `/community/posts/${postId}/comments?page=${page}&limit=${limit}`
      );
    },

    async createComment(postId: string, content: string, parentId?: string) {
      return request<Record<string, unknown>>(`/community/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parent_id: parentId ?? null }),
      });
    },

    async likeComment(postId: string, commentId: string) {
      return request<{ liked: boolean; like_count: number }>(
        `/community/posts/${postId}/comments/${commentId}/like`,
        { method: 'POST' }
      );
    },

    async deleteComment(postId: string, commentId: string) {
      return request(`/community/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE',
      });
    },
  },


  // ── Storage ──
  storage: {
    async upload(file: File, folder = 'uploads') {
      const token = getAccessToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);

      const res = await fetch(`${API_URL}/api/v1/storage/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) throw new ApiError('Upload failed', res.status);
      return res.json() as Promise<{
        success: boolean;
        urls: Record<string, string>;
        file_id: string;
      }>;
    },

    async presignedUrl(filename: string, contentType: string, folder = 'uploads') {
      return request<{ upload_url: string; public_url: string }>('/api/v1/storage/presigned-url', {
        method: 'POST',
        body: JSON.stringify({ filename, content_type: contentType, folder }),
      });
    },
  },

  // ── AI ──
  ai: {
    async generate(prompt: string, taskType = 'GENERAL') {
      return request<{ response: string; model_used: string }>('/api/v1/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, task_type: taskType }),
      });
    },

    async explain(prompt: string) {
      return request<{ response: string }>('/api/v1/ai/explain', {
        method: 'POST',
        body: JSON.stringify({ prompt, task_type: 'EDUCATIONAL_EXPLANATION' }),
      });
    },

    async lessonContent(courseTitle: string, lessonTitle: string, level = 'beginner') {
      return request<{ lesson_content: Record<string, unknown> }>('/api/v1/ai/lesson-content', {
        method: 'POST',
        body: JSON.stringify({ course_title: courseTitle, lesson_title: lessonTitle, level }),
      });
    },
  },

  // ── Resources ──
  resources: {
    async search(query: string, limit = 20) {
      return request<Record<string, unknown>[]>('/resources/search', {
        method: 'POST',
        body: JSON.stringify({ query, limit_per_provider: limit }),
      });
    },

    async trending(limit = 20) {
      return request<Record<string, unknown>[]>(`/resources/trending?limit=${limit}`);
    },
  },

  // ── Notifications ──
  notifications: {
    async list(page = 1, perPage = 20, type?: string) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (type) params.set('type', type);
      return request<{ notifications: Record<string, unknown>[]; total: number; unread_count: number }>(`/notifications?${params}`);
    },
    async markRead(notificationId: string) {
      return request(`/notifications/${notificationId}/read`, { method: 'POST' });
    },
    async markAllRead() {
      return request('/notifications/read-all', { method: 'POST' });
    },
    async unreadCount() {
      return request<{ count: number }>('/notifications/unread-count');
    },
  },

  // ── Discover ──
  discover: {
    async places(page = 1, perPage = 20, category?: string) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (category) params.set('category', category);
      return request<{ places: Record<string, unknown>[]; total: number }>(`/discover/places?${params}`);
    },

    async place(placeId: string) {
      return request<Record<string, unknown>>(`/discover/places/${placeId}`);
    },

    async trending() {
      return request<{ topics: Record<string, unknown>[]; resources: Record<string, unknown>[] }>('/discover/trending');
    },
  },

  // ── Generic helpers ──
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
};
