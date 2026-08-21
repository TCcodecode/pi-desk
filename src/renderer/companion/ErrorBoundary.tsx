import { Component, type ErrorInfo, type ReactNode } from "react";

export class CompanionErrorBoundary extends Component<
  { children: ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: Error): { error: string } {
    return { error: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[companion]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="companion-shell">
          <div className="companion-status is-down">
            <strong>Error</strong>
          </div>
          <pre className="companion-diff">{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
