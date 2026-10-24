/** Score colour on a 0–100 scale (pass 0–10 scores multiplied by 10). */
export function scoreTone(score: number) {
  if (score >= 80) return { color: '#34d399', label: 'Excellent', cls: 'text-good' };
  if (score >= 65) return { color: '#38bdf8', label: 'Good', cls: 'text-ok' };
  if (score >= 50) return { color: '#fbbf24', label: 'Fair', cls: 'text-warn' };
  return { color: '#fb7185', label: 'Needs work', cls: 'text-bad' };
}

export const HIRING_SIGNAL: Record<string, { label: string; color: string }> = {
  'strong-hire': { label: 'Strong hire', color: '#34d399' },
  hire: { label: 'Hire', color: '#34d399' },
  'lean-hire': { label: 'Leaning hire', color: '#38bdf8' },
  'lean-no': { label: 'Leaning no', color: '#fbbf24' },
  no: { label: 'Not yet', color: '#fb7185' },
};

export const DIMENSION_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  depth: 'Depth',
  structure: 'Structure',
  clarity: 'Clarity',
  relevance: 'Relevance',
  delivery: 'Delivery',
};

export const LEVEL_LABELS: Record<string, string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead',
};

/** "Junior Software Engineer", without doubling up when the role already names the level ("Junior Doctor"). */
export function roleLabel(level: keyof typeof LEVEL_LABELS, role?: string) {
  const lvl = LEVEL_LABELS[level];
  const r = (role || '').trim();
  if (!r) return `${lvl} candidate`;
  return r.toLowerCase().includes(lvl.toLowerCase()) ? r : `${lvl} ${r}`;
}

export function formatDuration(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function relativeDate(iso: string) {
  const date = new Date(iso);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** "Chrome · Android" from a user-agent string (good enough for a sign-in list). */
export function describeDevice(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|node|undici/i.test(ua)
              ? 'Script'
              : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iOS/.test(ua)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return os ? `${browser} · ${os}` : browser;
}

export const isMobileUa = (ua: string | null) => !!ua && /Android|iPhone|iPad|Mobile/.test(ua);

export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "12 min", "1 h 5 min" between two ISO timestamps. */
export function spanLabel(from: string, to: string) {
  const min = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}
