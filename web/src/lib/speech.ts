import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

// ---------- Text to speech (the interviewer's voice) ----------

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

function pickVoice(voiceURI: string, lang: string) {
  const voices = speechSynthesis.getVoices();
  if (voiceURI) {
    const chosen = voices.find((v) => v.voiceURI === voiceURI);
    if (chosen) return chosen;
  }
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const sameLocale = english.filter((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
  const pool = sameLocale.length ? sameLocale : english;
  return pool.find((v) => /natural|neural|google|samantha|daniel/i.test(v.name)) || pool[0] || null;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;
let keepAlive: ReturnType<typeof setInterval> | undefined;

/** Speaks text and resolves when done (or cancelled). */
export function speak(text: string, opts: { voiceURI: string; rate: number; lang: string }) {
  return new Promise<void>((resolve) => {
    if (!ttsSupported || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(opts.voiceURI, opts.lang);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || opts.lang;
    u.rate = opts.rate;
    const done = () => {
      clearInterval(keepAlive);
      if (currentUtterance === u) currentUtterance = null;
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    // Holding a reference stops Chrome from garbage-collecting the utterance mid-speech.
    currentUtterance = u;
    speechSynthesis.speak(u);
    // Chrome silently pauses long utterances after ~15s unless nudged.
    clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      if (!speechSynthesis.speaking) return clearInterval(keepAlive);
      speechSynthesis.pause();
      speechSynthesis.resume();
    }, 10_000);
  });
}

export function cancelSpeech() {
  clearInterval(keepAlive);
  if (ttsSupported) speechSynthesis.cancel();
}

// ---------- Little UI sounds ----------

let audioCtx: AudioContext | null = null;
export function chime(kind: 'start' | 'stop' | 'done') {
  try {
    audioCtx ||= new AudioContext();
    const notes = { start: [660, 880], stop: [660, 440], done: [523, 659, 784] }[kind];
    notes.forEach((freq, i) => {
      const t = audioCtx!.currentTime + i * 0.09;
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch {
    /* audio not available */
  }
}

// ---------- Speech to text (your answer) ----------

/* Minimal typing for the Web Speech API, which TypeScript's DOM lib doesn't fully cover. */
interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const RecognitionCtor: (new () => Recognition) | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, unknown>).SpeechRecognition as new () => Recognition) ||
      ((window as unknown as Record<string, unknown>).webkitSpeechRecognition as new () => Recognition)
    : undefined;

export const browserSttSupported = !!RecognitionCtor;
export const micSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export type SttEngine = 'browser' | 'whisper' | 'none';

export function resolveEngine(preferred: 'browser' | 'whisper', whisperAvailable: boolean): SttEngine {
  if (preferred === 'whisper' && whisperAvailable) return 'whisper';
  if (browserSttSupported) return 'browser';
  if (whisperAvailable) return 'whisper';
  return 'none';
}

const SILENCE_RMS = 0.012;
const PAUSE_MS = 2500;

export interface CaptureResult {
  transcript: string;
  durationSec: number;
  pauseCount: number;
}

/**
 * Records one answer: microphone level for the visualiser, pause detection, and a live
 * transcript (browser engine) or an uploaded recording transcribed by Whisper.
 */
export function useAnswerCapture({ engine, lang, prompt }: { engine: SttEngine; lang: string; prompt: string }) {
  const [status, setStatus] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const levelRef = useRef(0);

  const r = useRef({
    active: false,
    stream: null as MediaStream | null,
    ctx: null as AudioContext | null,
    raf: 0,
    timer: 0 as ReturnType<typeof setInterval> | 0,
    recognition: null as Recognition | null,
    recognitionEnded: null as (() => void) | null,
    recorder: null as MediaRecorder | null,
    chunks: [] as Blob[],
    startedAt: 0,
    pauses: 0,
    silentSince: 0,
    inPause: false,
    spoke: false,
    text: '',
    partial: '',
  });

  const teardown = useCallback(() => {
    const s = r.current;
    s.active = false;
    cancelAnimationFrame(s.raf);
    if (s.timer) clearInterval(s.timer);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.ctx?.close().catch(() => {});
    s.stream = null;
    s.ctx = null;
    levelRef.current = 0;
  }, []);

  useEffect(
    () => () => {
      r.current.recognition?.abort();
      if (r.current.recorder?.state === 'recording') r.current.recorder.stop();
      teardown();
    },
    [teardown],
  );

  const start = useCallback(
    async (initialText = '') => {
      const s = r.current;
      if (s.active) return;
      setError(null);
      setStatus('starting');
      s.text = initialText;
      s.partial = '';
      setFinalText(initialText);
      setInterim('');
      try {
        s.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        setStatus('idle');
        setError(
          (e as Error).name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow it in the browser address bar, or type your answer.'
            : 'No microphone found. Plug one in or type your answer.',
        );
        return;
      }
      s.active = true;
      s.pauses = 0;
      s.silentSince = 0;
      s.inPause = false;
      s.spoke = false;
      s.startedAt = performance.now();
      setElapsed(0);

      // Level meter + pause detection.
      s.ctx = new AudioContext();
      const analyser = s.ctx.createAnalyser();
      analyser.fftSize = 1024;
      s.ctx.createMediaStreamSource(s.stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!s.active) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        levelRef.current = levelRef.current * 0.6 + Math.min(1, rms * 9) * 0.4;
        const now = performance.now();
        if (rms > SILENCE_RMS) {
          s.spoke = true;
          s.silentSince = 0;
          s.inPause = false;
        } else if (s.spoke) {
          if (!s.silentSince) s.silentSince = now;
          else if (!s.inPause && now - s.silentSince > PAUSE_MS) {
            s.inPause = true;
            s.pauses += 1;
          }
        }
        s.raf = requestAnimationFrame(tick);
      };
      tick();
      s.timer = setInterval(() => setElapsed((performance.now() - s.startedAt) / 1000), 200);

      if (engine === 'browser' && RecognitionCtor) {
        const rec = new RecognitionCtor();
        rec.lang = lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
          let partial = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) s.text = `${s.text} ${res[0].transcript.trim()}`.trim();
            else partial += res[0].transcript;
          }
          s.partial = partial.trim();
          setFinalText(s.text);
          setInterim(s.partial);
        };
        rec.onerror = (e) => {
          if (e.error === 'no-speech' || e.error === 'aborted') return;
          if (e.error === 'not-allowed') setError('Speech recognition was blocked. Allow the microphone or type your answer.');
          else if (e.error === 'network') setError('Speech recognition needs internet access (Chrome sends audio to Google).');
          else setError(`Speech recognition error: ${e.error}`);
        };
        rec.onend = () => {
          // Chrome ends recognition after a stretch of silence; keep listening until stopped.
          if (s.active) {
            try {
              rec.start();
              return;
            } catch {
              /* fall through */
            }
          }
          s.recognitionEnded?.();
        };
        s.recognition = rec;
        rec.start();
      } else if (engine === 'whisper') {
        s.chunks = [];
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
        s.recorder = new MediaRecorder(s.stream, mime ? { mimeType: mime } : undefined);
        s.recorder.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
        s.recorder.start(1000);
      }
      setStatus('recording');
    },
    [engine, lang],
  );

  const stop = useCallback(async (): Promise<CaptureResult> => {
    const s = r.current;
    const durationSec = s.startedAt ? (performance.now() - s.startedAt) / 1000 : 0;
    const pauseCount = s.pauses;
    s.active = false;

    if (s.recognition) {
      const rec = s.recognition;
      s.recognition = null;
      // Late final results arrive after stop(); wait for the end event (or give up after 1.5s).
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1500);
        s.recognitionEnded = () => {
          clearTimeout(t);
          resolve();
        };
        rec.stop();
      });
      s.recognitionEnded = null;
      // Keep any words still in the interim buffer.
      if (s.partial) s.text = `${s.text} ${s.partial}`.trim();
      s.partial = '';
      setInterim('');
    }

    let blob: Blob | null = null;
    if (s.recorder) {
      const recorder = s.recorder;
      s.recorder = null;
      blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(s.chunks, { type: recorder.mimeType || 'audio/webm' }));
        recorder.stop();
      });
    }
    teardown();

    if (blob && blob.size > 0) {
      setStatus('transcribing');
      try {
        const { text } = await api.transcribe(blob, prompt, lang);
        s.text = `${s.text} ${text}`.trim();
      } catch (e) {
        setError(`Transcription failed: ${(e as Error).message}. You can type or re-record.`);
      }
    }
    setFinalText(s.text);
    setStatus('idle');
    return { transcript: s.text, durationSec, pauseCount };
  }, [lang, prompt, teardown]);

  const setText = useCallback((text: string) => {
    r.current.text = text;
    setFinalText(text);
  }, []);

  const reset = useCallback(() => {
    r.current.recognition?.abort();
    r.current.recognition = null;
    teardown();
    r.current.text = '';
    setFinalText('');
    setInterim('');
    setElapsed(0);
    setError(null);
    setStatus('idle');
  }, [teardown]);

  return {
    status,
    recording: status === 'recording',
    text: finalText,
    interim,
    error,
    elapsed,
    levelRef,
    start,
    stop,
    reset,
    setText,
    clearError: () => setError(null),
  };
}

/** Standalone mic level for the pre-interview mic check. */
export function useMicTest() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const levelRef = useRef(0);
  const peakRef = useRef(0);
  const cleanup = useRef<() => void>(() => {});

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 9);
        levelRef.current = levelRef.current * 0.6 + level * 0.4;
        peakRef.current = Math.max(peakRef.current, level);
        raf = requestAnimationFrame(tick);
      };
      tick();
      cleanup.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        levelRef.current = 0;
      };
      setActive(true);
    } catch (e) {
      setError((e as Error).name === 'NotAllowedError' ? 'Microphone permission denied' : 'No microphone available');
    }
  }, []);

  const stop = useCallback(() => {
    cleanup.current();
    setActive(false);
  }, []);

  useEffect(() => () => cleanup.current(), []);
  return { active, error, levelRef, peakRef, start, stop };
}
