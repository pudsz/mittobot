import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ShieldCheck, MessageSquareCode, Sparkles, Blocks, Database,
  Shield, Activity, Users, Disc, ChevronRight, BookOpen,
} from "lucide-react";

const FEATURES = [
  {
    Icon: ShieldCheck,
    title: "Advanced Automod",
    desc: "Powerful auto-moderation with configurable rules, word filters, spam protection, and automated enforcement — keep your community safe 24/7.",
  },
  {
    Icon: Sparkles,
    title: "AI Chat Assistant",
    desc: "Multi-provider AI chat with Groq, OpenAI, Claude, Gemini, and NVIDIA NIM. Fallback chain, memory, tools, and configurable personalities.",
  },
  {
    Icon: MessageSquareCode,
    title: "Welcome & Logging",
    desc: "Customizable join/leave messages, member event logging, moderation audit trails, and DM templates for automated notifications.",
  },
  {
    Icon: Shield,
    title: "Role Management",
    desc: "Auto-roles on join, reaction roles, role-based permissions, and a complete role hierarchy viewer with member listings.",
  },
  {
    Icon: Blocks,
    title: "Dynamic Modules",
    desc: "Live-load custom command modules without restarts. Write JavaScript commands that execute in the bot process with full API access.",
  },
  {
    Icon: Activity,
    title: "Server Monitoring",
    desc: "Real-time status dashboard with CPU, memory, ping, uptime tracking, command rate monitoring, and AI analytics.",
  },
  {
    Icon: Database,
    title: "Backup & Restore",
    desc: "Full server configuration backups with one-click restore. Schedule backups and keep your server safe from accidental changes.",
  },
  {
    Icon: Users,
    title: "Economy System",
    desc: "Full-featured economy with daily rewards, work, interest, gambling, shop with role purchases, and leaderboards.",
  },
];

const CODECARDS = [
  { label: "Groq", color: "#f0a020" },
  { label: "OpenAI", color: "#10a37f" },
  { label: "Claude", color: "#d97757" },
  { label: "Gemini", color: "#4285f4" },
  { label: "NVIDIA", color: "#76b900" },
  { label: "Requesty", color: "#a855f7" },
];

export default function LandingPage({ onGetStarted }) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="landing-page">
      {/* ─── Navigation ─── */}
      <header className={`landing-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="landing-nav-inner">
          <div className="landing-logo">
            <span className="landing-logo-mark">g</span>
            <span className="landing-logo-text">gboi</span>
          </div>
          <div className="landing-nav-links">
            <a href="#features" className="landing-nav-link">Features</a>
            <a href="#providers" className="landing-nav-link">Providers</a>
            <Link to="/docs" className="landing-nav-link">
              <BookOpen style={{ width: 14, height: 14 }} /> Docs
            </Link>
          </div>
          <button className="btn primary landing-nav-cta" onClick={onGetStarted}>
            <Disc style={{ width: 16, height: 16 }} />
            <span>Get Started</span>
            <ChevronRight style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />
        <div className="landing-hero-content">
          <div className="landing-hero-badge">
            <Activity style={{ width: 12, height: 12 }} />
            <span>v2.0 · Open Source Discord Bot</span>
          </div>
          <h1 className="landing-hero-title">
            Your Discord Server's
            <br />
            <span className="gradient-text">Command Center</span>
          </h1>
          <p className="landing-hero-sub">
            AI-powered moderation, intelligent chat, role management, economy, and server tools — 
            all from a single, self-hosted bot with a beautiful dashboard.
          </p>
          <div className="landing-hero-actions">
            <button className="btn primary landing-hero-primary" onClick={onGetStarted}>
              <Disc style={{ width: 18, height: 18 }} />
              <span>Launch Dashboard</span>
            </button>
            <a href="#features" className="btn secondary landing-hero-secondary auth-link-btn">
              <span>Explore Features</span>
              <ChevronRight style={{ width: 16, height: 16 }} />
            </a>
          </div>

          {/* Provider badges */}
          <div className="landing-provider-badges" id="providers">
            <span className="landing-provider-label">Multi-Provider AI</span>
            <div className="landing-provider-row">
              {CODECARDS.map((p) => (
                <span key={p.label} className="landing-provider-chip" style={{ "--chip-color": p.color }}>
                  {p.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats bar ─── */}
      <section className="landing-stats">
        <div className="landing-stats-inner">
          <div className="landing-stat">
            <span className="landing-stat-value">8+</span>
            <span className="landing-stat-label">Feature Categories</span>
          </div>
          <div className="landing-stat">
            <span className="landing-stat-value">50+</span>
            <span className="landing-stat-label">Commands</span>
          </div>
          <div className="landing-stat">
            <span className="landing-stat-value">5</span>
            <span className="landing-stat-label">AI Providers</span>
          </div>
          <div className="landing-stat">
            <span className="landing-stat-value">100%</span>
            <span className="landing-stat-label">Self-Hosted</span>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className="landing-features" id="features">
        <div className="landing-features-header">
          <h2>Everything you need to run a Discord server</h2>
          <p className="muted">
            From auto-moderation to AI-powered conversations — ggboi handles it all
            through a sleek, Discord-native dashboard.
          </p>
        </div>
        <div className="landing-features-grid">
          {FEATURES.map(({ Icon, title, desc }, i) => (
            <div key={i} className="landing-feature-card" style={{ "--feature-delay": `${0.05 * i}s` }}>
              <div className="landing-feature-icon-wrap">
                <Icon style={{ width: 22, height: 22 }} />
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="landing-cta">
        <div className="landing-cta-card">
          <h2>Ready to take control?</h2>
          <p className="muted">
            Self-hosted, fully open-source, and packed with features. 
            Get your Discord server the command center it deserves.
          </p>
          <div className="landing-cta-actions">
            <button className="btn primary landing-cta-primary" onClick={onGetStarted}>
              <Disc style={{ width: 18, height: 18 }} />
              <span>Launch Dashboard</span>
            </button>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-logo">
            <span className="landing-logo-mark">g</span>
            <span className="landing-logo-text">gboi</span>
          </div>
          <div className="muted landing-footer-copy">
            Open source Discord bot · Built with Node.js & React
          </div>
        </div>
      </footer>
    </div>
  );
}
