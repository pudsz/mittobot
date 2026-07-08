import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Disc, KeyRound, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { BASE, api } from "@/lib/api";

export default function LoginPage() {
  const { user, login, authError } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pwMode, setPwMode] = useState(false);
  const [hasDiscordOAuth, setHasDiscordOAuth] = useState(true);

  // Check if Discord OAuth is implemented / enabled on backend
  useEffect(() => {
    fetch(BASE + "/api/auth/discord", { method: "GET", redirect: "manual" })
      .then((res) => {
        if (res.status === 501) setHasDiscordOAuth(false);
      })
      .catch(() => setHasDiscordOAuth(false));
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate("/servers");
    }
  }, [user, navigate]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setError("");
    setLoading(true);
    try {
      const data = await api("POST", "/login", { password });
      if (data.token) {
        login(data.token);
      } else {
        setError("Invalid response from server");
      }
    } catch (err: any) {
      setError(err.message || "Invalid password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background bg-hero-grid flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/40 bg-card/90 backdrop-blur-md relative">
        <Button
          variant="ghost"
          size="sm"
          className="absolute left-4 top-4 text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="size-4 mr-2" />
          Back
        </Button>

        <CardHeader className="text-center pt-12">
          <CardTitle className="text-2xl font-bold tracking-tight">Mitto</CardTitle>
          <CardDescription>Dashboard</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {(error || authError) && (
            <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg p-3">
              <AlertTriangle className="size-4 shrink-0" />
              <p>{error || authError}</p>
            </div>
          )}

          {hasDiscordOAuth && !pwMode ? (
            <div className="space-y-4">
              <a href={BASE + "/api/auth/discord"} className="w-full block">
                <Button size="lg" className="w-full font-semibold gap-2.5 bg-[#5865F2] hover:bg-[#4752C4]">
                  <Disc className="size-5" />
                  Login with Discord
                </Button>
              </a>
              <p className="text-xs text-center text-muted-foreground">
                Access your Mitto dashboard.
              </p>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/40" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or fallback</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setPwMode(true)}
              >
                <KeyRound className="size-4 mr-2" />
                Use password (retiring)
              </Button>
            </div>
          ) : (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password/Label</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="ilovesigmaboys69"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full font-semibold" disabled={loading}>
                {loading ? "Verifying..." : "Log in"}
              </Button>
              {hasDiscordOAuth && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => {
                    setPwMode(false);
                    setError("");
                  }}
                >
                  <Disc className="size-4 mr-2" />
                  Back to Discord auth
                </Button>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
