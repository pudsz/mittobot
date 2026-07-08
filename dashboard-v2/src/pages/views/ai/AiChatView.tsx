import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, Bot, User, Loader2, AlertCircle } from "lucide-react";
import { getToken, BASE } from "@/lib/api";

interface Message { role: "user" | "assistant"; content: string; }

export default function AiChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setInput("");
    setError("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);

    try {
      const token = getToken();
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(BASE + "/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: userMsg, history, thinkingEnabled: false }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: "Request failed" })); throw new Error(err.error || `HTTP ${res.status}`); }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "token") {
              fullText += parsed.text;
              setMessages(prev => { const next = [...prev]; next[next.length - 1] = { role: "assistant", content: fullText }; return next; });
            } else if (parsed.type === "error") {
              setError(parsed.error);
            } else if (parsed.type === "done") {
              setMessages(prev => { const next = [...prev]; next[next.length - 1] = { role: "assistant", content: parsed.fullText || fullText }; return next; });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setError(err.message || "Chat failed");
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <Card className="border-border/40 bg-card/40 flex flex-col min-h-[500px]">
      <CardHeader className="pb-3 shrink-0 border-b border-border/20">
        <CardTitle className="text-sm font-semibold">Test Chat</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-16 space-y-3">
              <Bot className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">AI test playground. Type a message to start chatting.</p>
            </div>
          )}
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                {msg.role === "assistant" && <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0"><Bot className="size-4 text-primary" /></div>}
                <div className={`max-w-[80%] rounded-lg px-4 py-2.5 ${msg.role === "user" ? "bg-primary/20 border border-primary/20" : "bg-card/30 border border-border/40"}`}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content || (streaming && i === messages.length - 1 ? <span className="animate-pulse">...</span> : "")}</p>
                </div>
                {msg.role === "user" && <div className="size-8 rounded-full bg-secondary flex items-center justify-center shrink-0"><User className="size-4 text-muted-foreground" /></div>}
              </div>
            ))}
          </div>
        </div>

        {error && <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-destructive text-xs"><AlertCircle className="size-3.5" /><span>{error}</span></div>}

        <div className="flex items-center gap-2 p-4 border-t border-border/20">
          <Input className="flex-1 text-sm" placeholder={streaming ? "Waiting for response..." : "Send a message..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()} disabled={streaming} />
          <Button size="icon" onClick={send} disabled={streaming || !input.trim()}>
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
