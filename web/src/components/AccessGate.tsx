import { motion } from 'motion/react';
import { KeyRound, LogOut, RotateCcw, ShieldOff, UserX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, getDevUser, setDevUser, setToken } from '../lib/api';
import { loadMe } from '../lib/hooks';
import type { Me } from '../lib/types';
import { Button, Card } from './ui';
import { Orb } from './visuals';

type GateState = { status: 'loading' } | { status: 'ok'; me: Me } | { status: 'error'; error: ApiError | Error };

/** Loads the signed-in user before rendering the app, and explains why when access is refused. */
export function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const load = () => {
    setState({ status: 'loading' });
    loadMe(true).then(
      (me) => setState({ status: 'ok', me }),
      (error) => setState({ status: 'error', error }),
    );
  };
  useEffect(load, []);

  if (state.status === 'ok') return <>{children}</>;
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      {state.status === 'loading' ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          <Orb state="thinking" size={120} />
        </motion.div>
      ) : (
        <GateError error={state.error} onRetry={load} />
      )}
    </div>
  );
}

function Shell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
      <Card className="p-7 text-center sm:p-9">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">{icon}</div>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </Card>
    </motion.div>
  );
}

function GateError({ error, onRetry }: { error: ApiError | Error; onRetry: () => void }) {
  const [token, setTokenInput] = useState('');
  const code = error instanceof ApiError ? error.code : undefined;
  const email = error instanceof ApiError ? String(error.data.email || '') : '';
  const devUser = getDevUser();
  const backToMe = devUser && (
    <Button
      variant="ghost"
      className="mt-3"
      onClick={() => {
        setDevUser('');
        location.reload();
      }}
    >
      Stop viewing as {devUser}
    </Button>
  );

  if (code === 'not_invited' || code === 'disabled') {
    return (
      <Shell icon={code === 'disabled' ? <ShieldOff className="size-7 text-warn" /> : <UserX className="size-7 text-brand-soft" />} title={code === 'disabled' ? 'Access paused' : 'Invite needed'}>
        <p className="mt-3 text-ink-300">
          {code === 'disabled' ? 'Your access to Interview Sim has been paused.' : 'Interview Sim is invite-only, and this account is not on the list yet.'}
        </p>
        {email && (
          <p className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-sm break-all text-ink-200">{email}</p>
        )}
        <p className="mt-4 text-sm text-ink-400">Ask the owner to {code === 'disabled' ? 'restore your access' : 'invite this email'}, then reload.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button icon={<RotateCcw className="size-4" />} onClick={onRetry}>
            Try again
          </Button>
          <a href="/cdn-cgi/access/logout" className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm text-ink-300 hover:bg-white/5 hover:text-ink-100">
            <LogOut className="size-4" /> Use another account
          </a>
        </div>
        {backToMe}
      </Shell>
    );
  }

  if (error instanceof ApiError && error.status === 401) {
    return (
      <Shell icon={<KeyRound className="size-7 text-brand-soft" />} title="Sign in">
        <p className="mt-3 text-ink-300">Open the app through its Cloudflare link to sign in, or paste the owner's access token.</p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setToken(token.trim());
            onRetry();
          }}
        >
          <input className="field" type="password" placeholder="Access token" value={token} onChange={(e) => setTokenInput(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!token.trim()}>
            Go
          </Button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell icon={<ShieldOff className="size-7 text-bad" />} title="Can't reach Interview Sim">
      <p className="mt-3 text-ink-300">{error.message}</p>
      <Button className="mt-6" icon={<RotateCcw className="size-4" />} onClick={onRetry}>
        Try again
      </Button>
      {backToMe}
    </Shell>
  );
}
