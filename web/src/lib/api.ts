import type { ActivityEvent, AdminUser, AuthConfig, AdminUserDetail, CustomTopicData, Me, Meta, Question, Quota, Session, SessionConfig, SessionSummary, Stats } from './types';

const TOKEN_KEY = 'isim.token';
const DEV_USER_KEY = 'isim.devUser';

// Token-mode auth: open the app once with #token=... and it is remembered on this device.
(() => {
  const match = location.hash.match(/token=([^&]+)/);
  if (!match) return;
  try {
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]));
  } catch {
    /* storage unavailable */
  }
  history.replaceState(null, '', location.pathname + location.search);
})();

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Local development only (AUTH_MODE=none): act as another user to try multi-user flows. */
export function getDevUser() {
  try {
    return localStorage.getItem(DEV_USER_KEY) || '';
  } catch {
    return '';
  }
}

export function setDevUser(email: string) {
  try {
    if (email) localStorage.setItem(DEV_USER_KEY, email);
    else localStorage.removeItem(DEV_USER_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Ends the session for whichever way the user signed in, then reloads to the sign-in screen. */
export async function signOut(via?: string) {
  setToken('');
  if (via === 'cloudflare') {
    location.href = '/cdn-cgi/access/logout';
    return;
  }
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const devUser = getDevUser();
  if (devUser) headers['x-dev-user'] = devUser;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.code, data);
  return data as T;
}

export interface AnswerPayload {
  transcript: string;
  durationSec: number;
  pauseCount: number;
  skipped?: boolean;
  inputMode: 'voice' | 'typed';
}

const enc = encodeURIComponent;

export const api = {
  authConfig: () => request<AuthConfig>('GET', '/api/auth/config'),
  googleSignIn: (credential: string) => request<{ email: string }>('POST', '/api/auth/google', { credential }),
  me: () => request<Me>('GET', '/api/me'),
  meta: () => request<Meta>('GET', '/api/meta'),
  topics: () => request<CustomTopicData[]>('GET', '/api/topics'),
  saveTopic: (t: CustomTopicData) => request<CustomTopicData[]>('POST', '/api/topics', t),
  importTopics: (topics: CustomTopicData[]) => request<CustomTopicData[]>('POST', '/api/topics', { topics }),
  removeTopic: (name: string) => request<CustomTopicData[]>('DELETE', `/api/topics/${enc(name)}`),
  admin: {
    users: () => request<{ users: AdminUser[]; defaultLimit: number; day: string; onlineWindowMin: number }>('GET', '/api/admin/users'),
    user: (email: string) => request<AdminUserDetail>('GET', `/api/admin/users/${enc(email)}`),
    activity: () => request<{ events: ActivityEvent[] }>('GET', '/api/admin/activity'),
    addUser: (u: { email: string; name?: string; dailyLimit?: number | null }) => request<{ users: AdminUser[] }>('POST', '/api/admin/users', u),
    updateUser: (email: string, patch: { name?: string; status?: 'active' | 'disabled'; dailyLimit?: number | null }) =>
      request<{ users: AdminUser[] }>('PATCH', `/api/admin/users/${enc(email)}`, patch),
    removeUser: (email: string, deleteData: boolean) => request<{ users: AdminUser[] }>('DELETE', `/api/admin/users/${enc(email)}${deleteData ? '?deleteData=1' : ''}`),
  },
  stats: () => request<Stats>('GET', '/api/stats'),
  sessions: () => request<SessionSummary[]>('GET', '/api/sessions'),
  session: (id: string) => request<Session>('GET', `/api/sessions/${id}`),
  createSession: (config: Partial<SessionConfig>) => request<Session>('POST', '/api/sessions', config),
  createWeakSession: (config: Partial<SessionConfig>) => request<Session>('POST', '/api/sessions/weak', config),
  deleteSession: (id: string) => request<{ ok: true }>('DELETE', `/api/sessions/${id}`),
  answer: (id: string, qid: string, body: AnswerPayload) =>
    request<{ session: Session; question: Question; followUp: Question | null; deferred?: boolean }>(
      'POST',
      `/api/sessions/${id}/questions/${qid}/answer`,
      body,
    ),
  finish: (id: string) => request<Session>('POST', `/api/sessions/${id}/finish`),
  modelAnswer: (id: string, qid: string) => request<{ session: Session; question: Question }>('POST', `/api/sessions/${id}/questions/${qid}/model-answer`),
  quota: () => request<Quota>('GET', '/api/quota'),
  refreshQuota: () => request<Quota>('POST', '/api/quota/refresh'),
  transcribe: (audio: Blob, prompt: string, language: string) => {
    const form = new FormData();
    form.append('audio', audio, audio.type.includes('mp4') ? 'answer.mp4' : 'answer.webm');
    form.append('prompt', prompt);
    form.append('language', language);
    return request<{ text: string }>('POST', '/api/transcribe', form);
  },
};
