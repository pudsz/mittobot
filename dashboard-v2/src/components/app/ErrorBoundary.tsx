import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Changing this key resets the boundary (e.g. route path). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-16 text-center">
          <AlertTriangle className="size-8 text-destructive" />
          <div className="text-sm font-medium">This page crashed</div>
          <p className="max-w-md text-xs text-muted-foreground font-mono">
            {this.state.error.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
            <RefreshCw /> Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
