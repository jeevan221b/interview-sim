import { DIMENSION_LABELS, HIRING_SIGNAL, roleLabel } from './format';
import type { Session } from './types';

const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

export function reportMarkdown(s: Session) {
  const r = s.report!;
  const date = new Date(s.createdAt).toLocaleString();
  const lines = [
    `# ${s.config.topic} mock interview — ${r.overallScore}/100`,
    '',
    `${[s.config.field, roleLabel(s.config.level, s.config.role), s.config.type, date].filter(Boolean).join(' · ')}`,
    '',
    `**${r.headline}** (${HIRING_SIGNAL[r.hiringSignal]?.label ?? r.hiringSignal})`,
    '',
    r.summary,
    '',
    '## Scores',
    '',
    ...Object.entries(r.dimensions).map(([k, v]) => `- ${DIMENSION_LABELS[k] ?? k}: ${v}/10`),
    '',
    '## Strengths',
    list(r.strengths),
    '',
    '## Improvements',
    list(r.improvements),
    '',
    '## Study next',
    list(r.studyTopics),
    '',
    '## Delivery',
    `- Average pace: ${r.delivery.avgWpm || '–'} wpm`,
    `- Filler words: ${r.delivery.totalFillers} (${r.delivery.avgFillerRate}% of words)`,
    `- Long pauses: ${r.delivery.totalPauses}`,
    list(r.communicationTips),
    '',
    '## Questions',
  ];
  s.questions.forEach((q, i) => {
    const ev = q.evaluation;
    lines.push(
      '',
      `### ${i + 1}. ${q.followUpOf ? '(Follow-up) ' : ''}${q.text}`,
      '',
      `**Score:** ${ev ? `${ev.overall}/10 (${ev.verdict})` : '–'}`,
      '',
      `**Your answer:** ${q.answer?.skipped ? '_Skipped_' : q.answer?.transcript || '–'}`,
    );
    if (ev && !q.answer?.skipped) {
      lines.push('', `**Feedback:** ${ev.summary}`);
      if (ev.missedPoints.length) lines.push('', '**Missed:**', list(ev.missedPoints));
      if (ev.modelAnswer) lines.push('', '**Model answer:**', '', `> ${ev.modelAnswer.replace(/\n/g, '\n> ')}`);
    }
  });
  lines.push('', '## Next steps', list(r.nextSteps), '');
  return lines.join('\n');
}

export function download(filename: string, content: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
