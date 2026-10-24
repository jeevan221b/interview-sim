import { useCallback, useSyncExternalStore } from 'react';

// Per-device preferences (voice, language, engine). Sessions and scores live on the server.
export interface Settings {
  sttEngine: 'browser' | 'whisper';
  language: string;
  voiceURI: string;
  speechRate: number;
  autoRead: boolean;
  feedbackAfterEach: boolean;
  sounds: boolean;
}

const KEY = 'isim.settings';
const DEFAULTS: Settings = {
  sttEngine: 'browser',
  language: 'en-IN',
  voiceURI: '',
  speechRate: 1,
  autoRead: true,
  feedbackAfterEach: true,
  sounds: true,
};

function read(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function resetSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  current = DEFAULTS;
  listeners.forEach((l) => l());
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const value = useSyncExternalStore(
    useCallback((l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }, []),
    () => current,
  );
  return [value, updateSettings];
}

export const LANGUAGES = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-AU', label: 'English (Australia)' },
];
