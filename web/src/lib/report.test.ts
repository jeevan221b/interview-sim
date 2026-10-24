import { describe, expect, it } from 'vitest';
import { reportMarkdown } from './export';
import { formatDuration, scoreTone } from './format';
import type { Session } from './types';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(125.4)).toBe('2:05');
  });
  it('maps scores to tones', () => {
    expect(scoreTone(85).label).toBe('Excellent');
    expect(scoreTone(40).label).toBe('Needs work');
  });
});

describe('reportMarkdown', () => {
  it('includes scores, answers and model answers', () => {
    const metrics = { wordCount: 3, durationSec: 2, wpm: 90, fillerCount: 0, fillerRate: 0, fillers: {}, pauseCount: 0, delivery: 5 };
    const session = {
      id: 's1',
      createdAt: '2026-10-23T10:00:00.000Z',
      config: { topic: 'React', role: 'Frontend Developer', level: 'mid', type: 'technical' },
      questions: [
        {
          id: 'q1',
          text: 'What is reconciliation?',
          followUpOf: null,
          answer: { transcript: 'It diffs trees', skipped: false, metrics },
          evaluation: { overall: 6.5, verdict: 'good', summary: 'Decent.', missedPoints: ['keys'], modelAnswer: 'React compares…' },
        },
      ],
      report: {
        overallScore: 72,
        headline: 'Solid',
        summary: 'Good job.',
        hiringSignal: 'lean-hire',
        strengths: ['Clear'],
        improvements: ['Depth'],
        studyTopics: ['Fiber'],
        communicationTips: ['Slow down'],
        nextSteps: ['Retry'],
        dimensions: { accuracy: 7, delivery: 6 },
        delivery: { avgWpm: 140, totalFillers: 2, avgFillerRate: 1.2, totalPauses: 1 },
      },
    } as unknown as Session;
    const md = reportMarkdown(session);
    expect(md).toContain('# React mock interview — 72/100');
    expect(md).toContain('Leaning hire');
    expect(md).toContain('**Your answer:** It diffs trees');
    expect(md).toContain('> React compares…');
    expect(md).toContain('- keys');
  });
});
