import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearDraft } from '../doc/persist';
import './ErrorBoundary.css';

interface State {
  error: Error | null;
}

/** Last-resort screen: keeps the user's draft unless they explicitly choose to start over. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Форма: необработанная ошибка интерфейса', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  private resetAndReload = (): void => {
    try {
      clearDraft(window.localStorage);
    } catch {
      // Storage unavailable: a plain reload is all we can do.
    }
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1 className="crash__title">Что-то пошло не так</h1>
        <p className="crash__text">
          Интерфейс остановился из-за ошибки. Черновик сохраняется в&nbsp;браузере, поэтому обычно достаточно
          перезагрузить страницу.
        </p>
        <pre className="crash__details">{error.message}</pre>
        <div className="crash__actions">
          <button type="button" className="btn btn--primary" onClick={this.reload}>
            Перезагрузить
          </button>
          <button type="button" className="btn" onClick={this.resetAndReload}>
            Очистить черновик и начать заново
          </button>
        </div>
      </main>
    );
  }
}
