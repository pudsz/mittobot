import { Link } from "react-router-dom";
import { Terminal, Shield, Sparkles, Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background bg-hero-grid flex flex-col justify-between">
      {/* Navbar */}
      <header className="border-b border-border/40 backdrop-blur-md bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg border border-primary/20">
              <Terminal className="size-5 text-primary" />
            </div>
            <span className="font-semibold text-lg tracking-tight">ggboi</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link to="/docs" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Docs
            </Link>
            <Link to="/login">
              <Button size="sm" className="font-semibold">
                Control Panel
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 max-w-4xl mx-auto py-20">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary border border-primary/20 rounded-full px-4 py-1.5 text-xs font-semibold mb-6 animate-pulse">
          <Sparkles className="size-3.5" />
          ggboi Dashboard v2 is now live
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-6">
          The ultimate control deck for <span className="text-primary">ggboi</span>
        </h1>

        <p className="text-muted-foreground text-lg max-w-2xl mb-8">
          Manage your server, configure advanced automation rules, review cases, and supervise the AI assistant from a unified flight telemetry control panel.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
          <Link to="/login">
            <Button size="lg" className="w-full sm:w-auto font-semibold gap-2">
              Launch Console
              <ArrowRight className="size-4" />
            </Button>
          </Link>
          <Link to="/docs">
            <Button size="lg" variant="outline" className="w-full sm:w-auto font-semibold">
              Read Documentation
            </Button>
          </Link>
        </div>

        {/* Features grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24 text-left w-full max-w-5xl px-4">
          <div className="bg-card p-6 rounded-xl border border-border/40 hover:border-primary/30 transition-all group">
            <div className="size-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-all border border-primary/20">
              <Shield className="size-5 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Ops-Level Moderation</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Real-time automod rule builder, case evidence viewer, anti-raid gates, and active warning manager.
            </p>
          </div>

          <div className="bg-card p-6 rounded-xl border border-border/40 hover:border-primary/30 transition-all group">
            <div className="size-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-all border border-primary/20">
              <Sparkles className="size-5 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Integrated AI Assistant</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Supervise user conversations, search long-term AI memories, manage prompt packs, and review analytics.
            </p>
          </div>

          <div className="bg-card p-6 rounded-xl border border-border/40 hover:border-primary/30 transition-all group">
            <div className="size-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-all border border-primary/20">
              <Zap className="size-5 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Automated Operations</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Visual autoexec rule trigger engine, scheduled tasks, economy shop control, and server snapshot backups.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/20 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} ggboi. All rights reserved. Designed for flight-deck telemetry.
        </div>
      </footer>
    </div>
  );
}
