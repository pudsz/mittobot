import { useState, useRef, useEffect } from "react";
import { Send, User, Bot, Wrench, Trash2, Cpu, MessageSquare } from "lucide-react";
import { api, BASE } from "../api.js";

function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      gap: 10,
      marginBottom: 12,
      padding: "8px 12px",
      borderRadius: 8,
      background: isUser ? "rgba(99,179,237,0.08)" : "rgba(255,255,255,0.02)",
      border: isUser ? "1px solid rgba(99,179,237,0.15)" : "1px solid var(--border)",
    }}>
      <div style={{ flexShrink: 0, paddingTop: 2, color: isUser ? "var(--accent)" : "var(--muted)" }}>
        {isUser ? <User style={{ width: 16, height: 16 }} /> : <Bot style={{ width: 16, height: 16 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
          {isUser ? "You" : "Bot"}
          {msg.provider && <span style={{ marginLeft: 8 }}>via {msg.provider}</span>}
        </div>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
          {msg.content}
          {msg.isStreaming && <span className="cursor-blink">▌</span>}
        </div>
        {msg.tools && msg.tools.length > 0 && msg.tools.map((t, i) => (
          <div key={i} style={{
            marginTop: 8,
            padding: "6px 10px",
            background: "rgba(240,160,32,0.08)",
            border: "1px solid rgba(240,160,32,0.15)",
            borderRadius: 6,
            fontSize: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Wrench style={{ width: 12, height: 12, color: "#f0a020" }} />
              <span style={{ color: "#f0a020", fontWeight: 600 }}>Tool: {t.name}</span>
            </div>
            {t.result && <div style={{ color: "var(--muted)", whiteSpace: "pre-wrap" }}>{t.result}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AiChatTab({ guildId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeProvider, setActiveProvider] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    setInput("");
    setIsStreaming(true);

    const userMsg = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);

    // Create a placeholder bot message for streaming
    const botMsg = { role: "assistant", content: "", isStreaming: true, tools: [], provider: null };
    setMessages(prev => [...prev, botMsg]);

    try {
      const res = await fetch(BASE + "/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, guildId: guildId || undefined }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from the buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            switch (data.type) {
              case "token":
                setMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: m.content + data.text } : m
                ));
                break;
              case "done":
                setMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, isStreaming: false, fullText: data.fullText } : m
                ));
                done = true;
                break;
              case "error":
                setMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: `❌ Error: ${data.error}`, isStreaming: false } : m
                ));
                done = true;
                break;
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: `❌ ${err.message}`, isStreaming: false } : m
      ));
    } finally {
      setIsStreaming(false);
    }
  }

  async function fetchProvider() {
    try {
      const d = await api("GET", "/api/ai");
      if (d.providers) {
        const p = d.providers.find(x => x.id === d.aiProvider);
        if (p) setActiveProvider(p.label);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchProvider(); }, []);

  function clearChat() {
    setMessages([]);
  }

  return (
    <div className="tab active" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)" }}>
      <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <MessageSquare style={{ width: 20, height: 20 }} />
            <span style={{ fontSize: 16, fontWeight: 400 }}>AI Chat Playground</span>
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {activeProvider && (
              <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                <Cpu style={{ width: 12, height: 12 }} /> {activeProvider}
              </span>
            )}
            <button className="btn danger" onClick={clearChat} style={{ padding: "4px 10px", fontSize: 12 }}>
              <Trash2 style={{ width: 14, height: 14 }} /> Clear
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
          Chat directly with the bot's AI. Responses stream in real-time. This is the same AI your server members talk to.
        </p>

        {/* Chat area */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            background: "rgba(0,0,0,0.1)",
            marginBottom: 12,
          }}
        >
          {messages.length === 0 && (
            <div className="muted" style={{ textAlign: "center", padding: 40 }}>
              Send a message to test the AI. Responses stream in real-time with a typewriter effect.
            </div>
          )}
          {messages.map((msg, i) => (
            <ChatMessage key={i} msg={msg} />
          ))}
        </div>

        {/* Input area */}
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder={isStreaming ? "Waiting for response..." : "Type a message to the AI..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            disabled={isStreaming}
            style={{ flex: 1 }}
          />
          <button className="btn green" onClick={sendMessage} disabled={isStreaming || !input.trim()}>
            <Send style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </div>
  );
}
