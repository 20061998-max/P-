import { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Ocorreu um erro inesperado na interface.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro capturado pelo ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-500 shrink-0" />
              <h1 className="font-display text-2xl font-bold text-white">
                Falha de conexão ou permissão
              </h1>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Não foi possível concluir uma operação com o banco de dados. Tente recarregar ou
              entrar novamente com sua conta autorizada.
            </p>
            {this.state.message && (
              <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[11px] text-zinc-400 break-words">
                {this.state.message}
              </p>
            )}
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="w-full rounded-lg bg-[#C8102E] py-2.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
