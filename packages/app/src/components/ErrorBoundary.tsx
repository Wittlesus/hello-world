import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label ?? 'unknown'}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#09090f]">
          <div className="max-w-xl w-full">
            <div className="text-xs font-mono text-red-400 uppercase tracking-widest mb-3">
              render error — {this.props.label ?? 'component'}
            </div>
            <pre className="text-[11px] font-mono text-red-300/80 bg-red-950/20 border border-red-900/40 rounded p-4 overflow-auto max-h-64 whitespace-pre-wrap break-all">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button
              className="mt-4 text-xs font-mono text-gray-500 hover:text-gray-300 border border-gray-800 rounded px-3 py-1"
              onClick={() => this.setState({ error: null })}
            >
              retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
