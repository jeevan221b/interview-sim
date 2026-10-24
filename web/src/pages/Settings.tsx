import { motion } from 'motion/react';
import { AudioLines, Bot, UserRound, CheckCircle2, CircleAlert, KeyRound, Languages, Mic, RotateCcw, ShieldCheck, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../components/Layout';
import { Badge, Button, Card, PageHeader, SectionTitle, Segmented, Slider, Toggle, stagger, useToast } from '../components/ui';
import { getToken, setToken } from '../lib/api';
import { cx } from '../lib/format';
import { useMe, useMeta } from '../lib/hooks';
import { LANGUAGES, resetSettings, useSettings } from '../lib/settings';
import { browserSttSupported, speak, ttsSupported, useVoices } from '../lib/speech';

export function SettingsPage() {
  const [settings, update] = useSettings();
  const meta = useMeta();
  const me = useMe().data;
  const voices = useVoices();
  const toast = useToast();
  const [token, setTokenInput] = useState(getToken());
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));

  return (
    <motion.div variants={stagger.container} initial="hidden" animate="show">
      <PageHeader title="Settings" subtitle={me?.isAdmin ? 'Voice, speech recognition and AI setup. Voice preferences are saved on this device.' : 'Voice and speech recognition. Preferences are saved on this device.'} />

      <div className="grid gap-5 lg:grid-cols-2">
        <motion.div variants={stagger.item}>
          <Card className="space-y-6 p-5 sm:p-6">
            <SectionTitle icon={<Mic className="size-5" />}>Speech to text</SectionTitle>
            <div>
              <Segmented
                id="stt"
                value={settings.sttEngine}
                onChange={(sttEngine) => {
                  if (sttEngine === 'whisper' && !meta.data?.whisper) {
                    toast('Whisper needs GROQ_API_KEY in the server .env', 'error');
                    return;
                  }
                  update({ sttEngine });
                }}
                options={[
                  { value: 'browser', label: 'Browser', hint: 'Live captions' },
                  { value: 'whisper', label: 'Whisper', hint: meta.data?.whisper ? 'More accurate' : 'Needs Groq key' },
                ]}
              />
              <p className="mt-2 text-xs text-ink-400">
                {settings.sttEngine === 'browser'
                  ? browserSttSupported
                    ? 'Words appear as you speak. Works in Chrome and Edge (audio is processed by the browser vendor).'
                    : 'This browser has no speech recognition. Use Chrome/Edge, switch to Whisper, or type answers.'
                  : 'Your answer is recorded and transcribed by Whisper when you stop. Better with accents and technical terms.'}
              </p>
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
                <Languages className="size-4 text-brand-soft" /> Accent / language
              </label>
              <select className="field" value={settings.language} onChange={(e) => update({ language: e.target.value })}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} className="bg-ink-900">
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={stagger.item}>
          <Card className="space-y-6 p-5 sm:p-6">
            <SectionTitle icon={<AudioLines className="size-5" />}>Interviewer</SectionTitle>
            <Toggle checked={settings.autoRead} onChange={(autoRead) => update({ autoRead })} label="Read questions aloud" description={ttsSupported ? 'Uses your browser’s built-in voices.' : 'Not supported in this browser.'} />
            <div>
              <label className="mb-2 block text-sm font-medium text-ink-200">Voice</label>
              <div className="flex gap-2">
                <select className="field" value={settings.voiceURI} onChange={(e) => update({ voiceURI: e.target.value })}>
                  <option value="" className="bg-ink-900">
                    Automatic (best match)
                  </option>
                  {english.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI} className="bg-ink-900">
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
                <Button
                  aria-label="Preview voice"
                  icon={<Volume2 className="size-4" />}
                  onClick={() => speak('Tell me about a project you are proud of.', { voiceURI: settings.voiceURI, rate: settings.speechRate, lang: settings.language })}
                />
              </div>
            </div>
            <div>
              <div className="mb-3 flex justify-between text-sm font-medium text-ink-200">
                <span>Speaking speed</span>
                <span className="tabular-nums">{settings.speechRate.toFixed(2)}×</span>
              </div>
              <Slider ariaLabel="Speaking speed" min={0.7} max={1.4} step={0.05} value={settings.speechRate} onChange={(speechRate) => update({ speechRate })} />
            </div>
            <Toggle checked={settings.feedbackAfterEach} onChange={(feedbackAfterEach) => update({ feedbackAfterEach })} label="Quick feedback after each answer" description="Off = uninterrupted interview, feedback only at the end." />
            <Toggle checked={settings.sounds} onChange={(sounds) => update({ sounds })} label="Sound cues" description="Soft chimes when recording starts and stops." />
          </Card>
        </motion.div>

        <motion.div variants={stagger.item}>
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<UserRound className="size-5" />}>Your account</SectionTitle>
            {me && (
              <>
                <div className="flex items-center gap-3">
                  <Avatar email={me.email} name={me.name} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{me.name || me.email}</div>
                    {me.name && <div className="truncate text-sm text-ink-400">{me.email}</div>}
                  </div>
                  <span className="ml-auto">{me.isAdmin ? <Badge color="#34d399">Admin</Badge> : <Badge>Member</Badge>}</span>
                </div>
                <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-300">AI requests today</span>
                    <span className="tabular-nums">
                      {me.usage.used}
                      {me.usage.limit !== null ? ` / ${me.usage.limit}` : ''}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-400">
                    {me.usage.limit !== null
                      ? 'Each interview uses a few requests (fewer with grading at the end). The count resets at midnight.'
                      : 'No daily limit on your account.'}
                  </p>
                </div>
                <p className="mt-3 text-xs text-ink-400">Your interviews, history and custom topics are private to your account and follow you to any device.</p>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-4 -ml-2"
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                resetSettings();
                toast('Preferences reset on this device', 'success');
              }}
            >
              Reset preferences
            </Button>
          </Card>
        </motion.div>

        {me?.isAdmin && (
          <>
        <motion.div variants={stagger.item}>
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Bot className="size-5" />}>AI providers</SectionTitle>
            {meta.error ? (
              <p className="flex items-center gap-2 text-sm text-bad">
                <CircleAlert className="size-4" /> {meta.error}
              </p>
            ) : (
              <ol className="space-y-2">
                {meta.data?.providers?.map((p, i) => (
                  <li key={p.name} className={cx('flex items-center gap-3 rounded-xl border p-3', i === 0 ? 'border-brand-soft/30 bg-brand/[0.06]' : 'border-white/5')}>
                    <span className="flex size-7 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold">{i + 1}</span>
                    <span className="flex-1 text-sm">{p.label}</span>
                    {i === 0 ? <Badge color="#34d399">Primary</Badge> : <Badge>Fallback</Badge>}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-4 text-xs text-ink-400">
              Configured on the server in <code className="rounded bg-white/5 px-1">.env</code> (LLM_PROVIDERS, GROQ_API_KEY). Groq also powers Whisper transcription.
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs">
              {meta.data?.whisper ? <CheckCircle2 className="size-4 text-good" /> : <CircleAlert className="size-4 text-ink-400" />}
              <span className="text-ink-300">Whisper transcription {meta.data?.whisper ? 'available' : 'not configured'}</span>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={stagger.item}>
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<ShieldCheck className="size-5" />}>Access</SectionTitle>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-300">Server auth mode</span>
              <Badge color={meta.data?.authMode === 'none' ? '#fbbf24' : '#34d399'}>{meta.data?.authMode ?? '…'}</Badge>
            </div>
            <div className="mt-5">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
                <KeyRound className="size-4 text-brand-soft" /> Access token (token mode)
              </label>
              <div className="flex gap-2">
                <input type="password" className="field" placeholder="Paste ACCESS_TOKEN" value={token} onChange={(e) => setTokenInput(e.target.value)} autoComplete="off" />
                <Button
                  onClick={() => {
                    setToken(token.trim());
                    toast(token.trim() ? 'Token saved on this device' : 'Token removed', 'success');
                  }}
                >
                  Save
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-400">Only needed when reaching the server without Cloudflare Access (e.g. over Tailscale).</p>
            </div>
          </Card>
        </motion.div>
          </>
        )}
      </div>
    </motion.div>
  );
}
