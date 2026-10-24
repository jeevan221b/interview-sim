import { motion } from 'motion/react';
import { KeyRound, LogOut, RotateCcw, ShieldOff, UserX } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, getDevUser, setDevUser, setToken, signOut } from '../lib/api';
import { loadMe } from '../lib/hooks';
import type { AuthConfig, Me } from '../lib/types';
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
          <button
            onClick={() => signOut(String(error instanceof ApiError ? error.data.via || '' : ''))}
            className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm text-ink-300 hover:bg-white/5 hover:text-ink-100"
          >
            <LogOut className="size-4" /> Use another account
          </button>
        </div>
        {backToMe}
      </Shell>
    );
  }

  if (error instanceof ApiError && error.status === 401) return <SignIn onSignedIn={onRetry} />;

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

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [token, setTokenInput] = useState('');
  useEffect(() => {
    api.authConfig().then(setConfig, () => setConfig({ modes: [], googleClientId: null }));
  }, []);
  if (!config) return <Orb state="thinking" size={120} />;
  const tokenMode = config.modes.includes('token');

  return (
    <Shell icon={<KeyRound className="size-7 text-brand-soft" />} title="Sign in">
      <p className="mt-3 text-ink-300">
        {config.googleClientId
          ? 'Interview Sim is invite-only. Sign in with the Google account your invite was sent to.'
          : config.modes.includes('cloudflare')
            ? 'Open the app through its Cloudflare link to sign in.'
            : "Paste the owner's access token to continue."}
      </p>
      {config.googleClientId && <GoogleButton clientId={config.googleClientId} onSignedIn={onSignedIn} />}
      {tokenMode && (
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setToken(token.trim());
            onSignedIn();
          }}
        >
          <input className="field" type="password" placeholder="Access token" value={token} onChange={(e) => setTokenInput(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!token.trim()}>
            Go
          </Button>
        </form>
      )}
    </Shell>
  );
}

type GoogleId = {
  initialize(options: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup' }): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let gisScript: Promise<GoogleId> | null = null;
/** Google Identity Services, loaded only when the sign-in screen needs it. */
function loadGoogleId() {
  gisScript ??= new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load.')));
    script.onerror = () => {
      gisScript = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection and reload."));
    };
    document.head.appendChild(script);
  });
  return gisScript;
}

function GoogleButton({ clientId, onSignedIn }: { clientId: string; onSignedIn: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadGoogleId().then(
      (gid) => {
        if (!live || !ref.current) return;
        gid.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: ({ credential }) => {
            setError('');
            api.googleSignIn(credential).then(onSignedIn, (e: Error) => setError(e.message));
          },
        });
        gid.renderButton(ref.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [clientId, onSignedIn]);

  return (
    <div className="mt-6">
      <div ref={ref} className="flex min-h-11 justify-center" />
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
    </div>
  );
}
