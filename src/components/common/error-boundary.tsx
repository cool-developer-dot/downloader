import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { ErrorFallback } from '@/components/common/error-fallback';

type ErrorBoundaryProps = PropsWithChildren<{
  fallback?: (props: { error: Error; resetError: () => void }) => ReactNode;
}>;

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) {
      console.error('Unhandled application error:', error, info.componentStack);
    }
  }

  resetError = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) {
        return fallback({ error, resetError: this.resetError });
      }

      return <ErrorFallback error={error} resetError={this.resetError} />;
    }

    return children;
  }
}
