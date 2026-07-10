import React, { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import LandingPage from "@/pages/LandingPage";
import DocsPage from "@/pages/DocsPage";
import LoginPage from "@/pages/LoginPage";
import ServerPickerPage from "@/pages/ServerPickerPage";
import AppShell from "@/components/app/AppShell";

// Lazy-loaded pages for optimization
const Overview = React.lazy(() => import("@/pages/Overview"));
const ModerationHub = React.lazy(() => import("@/pages/ModerationHub"));
const CommunityHub = React.lazy(() => import("@/pages/CommunityHub"));
const EngagementHub = React.lazy(() => import("@/pages/EngagementHub"));
const AiHub = React.lazy(() => import("@/pages/AiHub"));
const CommandsPage = React.lazy(() => import("@/pages/CommandsPage"));
const SystemHub = React.lazy(() => import("@/pages/SystemHub"));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4">
        <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span className="text-muted-foreground text-sm font-mono">Verifying credentials...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Guild Selector */}
      <Route
        path="/servers"
        element={
          <PrivateRoute>
            <ServerPickerPage />
          </PrivateRoute>
        }
      />

      {/* Guild dashboard views */}
      <Route
        path="/g/:guildId"
        element={
          <PrivateRoute>
            <AppShell />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route
          path="overview"
          element={
            <Suspense fallback={<LoadingFallback text="Loading Overview Telemetry..." />}>
              <Overview />
            </Suspense>
          }
        />
        <Route
          path="moderation/*"
          element={
            <Suspense fallback={<LoadingFallback text="Loading Moderation Deck..." />}>
              <ModerationHub />
            </Suspense>
          }
        />
        <Route
          path="community/*"
          element={
            <Suspense fallback={<LoadingFallback text="Loading Community Deck..." />}>
              <CommunityHub />
            </Suspense>
          }
        />
        <Route
          path="engagement/*"
          element={
            <Suspense fallback={<LoadingFallback text="Loading Engagement Deck..." />}>
              <EngagementHub />
            </Suspense>
          }
        />
        <Route
          path="ai/*"
          element={
            <Suspense fallback={<LoadingFallback text="Loading AI Command Engine..." />}>
              <AiHub />
            </Suspense>
          }
        />
        <Route
          path="commands"
          element={
            <Suspense fallback={<LoadingFallback text="Loading Commands configuration..." />}>
              <CommandsPage />
            </Suspense>
          }
        />
      </Route>

      {/* System views */}
      <Route
        path="/system/*"
        element={
          <PrivateRoute>
            <AppShell />
          </PrivateRoute>
        }
      >
        <Route
          path="*"
          element={
            <Suspense fallback={<LoadingFallback text="Loading System Diagnostics..." />}>
              <SystemHub />
            </Suspense>
          }
        />
      </Route>

      {/* Catch All Redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LoadingFallback({ text }: { text: string }) {
  return (
    <div className="p-8 flex flex-col items-center justify-center space-y-4 py-20">
      <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <span className="text-muted-foreground text-xs font-mono">{text}</span>
    </div>
  );
}
