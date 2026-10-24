import { CircleAlert, RotateCcw } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Button, Card } from './ui';

/** Keeps one broken page from blanking the whole app; resets when the route changes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card className="mx-auto mt-10 max-w-md p-7 text-center">
        <CircleAlert className="mx-auto size-8 text-bad" />
        <h2 className="mt-3 font-display text-xl font-semibold">This page hit an error</h2>
        <p className="mt-2 text-sm text-ink-300">
          If the server was just updated, restart it so the app and server match. Details: <span className="text-ink-400">{this.state.error.message}</span>
        </p>
        <Button className="mt-5" icon={<RotateCcw className="size-4" />} onClick={() => location.reload()}>
          Reload
        </Button>
      </Card>
    );
  }
}
