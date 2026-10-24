import type { SpeechMetrics } from '../../../shared/metrics.js';

export type { SpeechMetrics };

export type Level = 'intern' | 'junior' | 'mid' | 'senior' | 'lead';
export type InterviewType = 'technical' | 'behavioral' | 'mixed';
export type Dimension = 'accuracy' | 'depth' | 'structure' | 'clarity' | 'relevance';

export interface SessionConfig {
  topic: string;
  /** Broad field, e.g. "Electrical & Electronics" or anything custom. */
  field?: string;
  /** Optional sub-areas to concentrate on (mainly for custom topics). */
  focus?: string;
  role: string;
  level: Level;
  type: InterviewType;
  questionCount: number;
  answerSeconds: number;
  thinkSeconds: number;
  followUps: boolean;
  context: string;
  /** "each" grades after every answer (instant feedback, follow-ups); "end" batches it at the finish. */
  grading?: Grading;
  modelAnswers?: ModelAnswers;
}

export type Grading = 'each' | 'end';
export type ModelAnswers = 'brief' | 'full' | 'off';

export interface Evaluation {
  scores: Record<Dimension, number>;
  overall: number;
  verdict: 'strong' | 'good' | 'fair' | 'weak';
  summary: string;
  strengths: string[];
  improvements: string[];
  coveredPoints: string[];
  missedPoints: string[];
  star: { situation: boolean; task: boolean; action: boolean; result: boolean } | null;
  followUp: string | null;
  modelAnswer: string;
  provider: string | null;
  model?: string | null;
}

export interface Answer {
  transcript: string;
  skipped: boolean;
  metrics: SpeechMetrics;
  inputMode: 'voice' | 'typed';
  answeredAt: string | null;
}

export interface Question {
  id: string;
  text: string;
  kind: 'technical' | 'behavioral';
  focus?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  idealPoints: string[];
  followUpOf: string | null;
  answer: Answer | null;
  evaluation: Evaluation | null;
}

export interface Delivery {
  answered: number;
  total: number;
  avgWpm: number;
  totalFillers: number;
  avgFillerRate: number;
  totalPauses: number;
  speakingSec: number;
  avgWords: number;
  avgDelivery: number;
}

export interface Report {
  overallScore: number;
  headline: string;
  summary: string;
  hiringSignal: 'strong-hire' | 'hire' | 'lean-hire' | 'lean-no' | 'no';
  strengths: string[];
  improvements: string[];
  studyTopics: string[];
  communicationTips: string[];
  nextSteps: string[];
  dimensions: Record<Dimension | 'delivery', number>;
  delivery: Delivery;
  provider: string;
  model?: string | null;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  status: 'active' | 'completed';
  provider: string;
  config: SessionConfig;
  questions: Question[];
  report: Report | null;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: 'active' | 'completed';
  config: Pick<SessionConfig, 'topic' | 'field' | 'role' | 'level' | 'type'>;
  questionCount: number;
  answered: number;
  overallScore: number | null;
  headline: string | null;
  provider: string;
}

export interface Stats {
  totalSessions: number;
  completedSessions: number;
  avgScore: number | null;
  bestScore: number | null;
  questionsAnswered: number;
  practiceMinutes: number;
  streakDays: number;
  byTopic: { topic: string; count: number; avg: number; best: number; last: string }[];
  trend: { id: string; date: string; score: number; topic: string }[];
  weakCount: number;
}

export interface ModelQuota {
  model: string;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  tokensLimit: number | null;
  tokensRemaining: number | null;
  limitedUntil: string | null;
  updatedAt: string | null;
  usedToday: { requests: number; tokens: number };
}

export interface Quota {
  provider: string | null;
  models: ModelQuota[];
}

export interface Meta {
  providers: { name: string; label: string; models?: string[] }[];
  whisper: boolean;
  authMode: string;
  user: string | null;
}
