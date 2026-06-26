import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Catches render errors in the component tree and shows a recovery UI
 * instead of a white screen. Resets on tab/guild change via the key prop.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidUpdate(prevProps) {
    // Reset when the key changes (tab/guild switches)
    if (prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, errorInfo: null });
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 24px",
            textAlign: "center",
            animation: "fadeSlideIn 0.3s ease",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--red-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <AlertTriangle style={{ width: 28, height: 28, color: "var(--red)" }} />
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600 }}>
            Something went wrong
          </h2>
          <p className="muted" style={{ maxWidth: 400, marginBottom: 16 }}>
            An unexpected error occurred while rendering this section.
            Try switching tabs or refreshing the page.
          </p>
          <button
            className="btn primary"
            onClick={() => this.setState({ error: null, errorInfo: null })}
          >
            <RefreshCw style={{ width: 14, height: 14 }} />
            <span>Try again</span>
          </button>
          {this.state.errorInfo && (
            <details style={{ marginTop: 20, maxWidth: 600, width: "100%", textAlign: "left" }}>
              <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 12 }}>
                Error details
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  maxHeight: 200,
                  overflow: "auto",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 12,
                  whiteSpace: "pre-wrap",
                }}
              >
                {this.state.error?.toString()}
                {"\n\n"}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
