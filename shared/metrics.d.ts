export const FILLER_PHRASES: string[];
export function countWords(text: string): number;
export function findFillers(text: string): { total: number; byWord: Record<string, number> };
export function splitFillers(text: string): { text: string; filler: boolean }[];
export interface SpeechMetrics {
  wordCount: number;
  durationSec: number;
  wpm: number;
  fillerCount: number;
  fillerRate: number;
  fillers: Record<string, number>;
  pauseCount: number;
  delivery: number;
}
export function computeMetrics(transcript: string, durationSec?: number, pauseCount?: number): SpeechMetrics;
export function deliveryScore(m: { wordCount: number; wpm: number; fillerRate: number; pauseCount: number; durationSec: number }): number;
