import { useState, useRef, useEffect } from "react";
import { Send, Wrench, Trash2, Cpu, ChevronDown, Square } from "lucide-react";
import { api, BASE, getToken, clearToken } from "../api.js";

const SUGGESTIONS = [
  "Explain how automod works",
  "Write a Python script",
  "Summarize this conversation",
  "Help me debug this error",
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 16,
    }}>
      <div style={{
        maxWidth: "70%",
        padding: "10px 16px",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        background: isUser
          ? "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent), #000 15%))"
          : "var(--surface)",
        border: isUser ? "none" : "1px solid var(--border)",
        color: isUser ? "#fff" : "var(--text)",
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {msg.content}
        {msg.isStreaming && <span className="cursor-blink">▌</span>}
        {!isUser && (msg.provider || msg.model) && (
          <div style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: "1px solid var(--border)",
            color: "var(--muted)",
            fontSize: 11,
            fontFamily: "monospace",
            lineHeight: 1.3,
          }}>
            {[msg.provider, msg.model].filter(Boolean).join(" · ")}
          </div>
        )}
        {msg.tools && msg.tools.length > 0 && msg.tools.map((t, i) => (
          <div key={t._key || t.name || i} style={{
            marginTop: 8,
            padding: "6px 10px",
            background: "rgba(240,160,32,0.1)",
            border: "1px solid rgba(240,160,32,0.2)",
            borderRadius: 8,
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

function EmptyState({ onSuggestion }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      flex: 1,
      padding: "40px 20px",
    }}>
      <h1 style={{
        fontSize: 28,
        fontWeight: 600,
        margin: "0 0 8px",
        color: "var(--text)",
      }}>
        {getGreeting()}.
      </h1>
      <p style={{
        fontSize: 15,
        color: "var(--muted)",
        margin: "0 0 24px",
      }}>
        What can I help you with?
      </p>
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        justifyContent: "center",
        maxWidth: 500,
      }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.target.style.background = "var(--surface-hover)";
              e.target.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.target.style.background = "var(--surface)";
              e.target.style.borderColor = "var(--border)";
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelPicker({ models, selected, onSelect, provider }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!models || models.length === 0) return null;

  const shortName = (m) => {
    const parts = m.split("/");
    return parts[parts.length - 1];
  };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "7px 12px",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--surface-hover)",
          color: "var(--text)",
          fontSize: 12,
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s ease",
          lineHeight: 1,
        }}
        title={selected}
      >
        <Cpu style={{ width: 13, height: 13, color: "var(--muted)", flexShrink: 0 }} />
        <span style={{
          maxWidth: 110,
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: "monospace",
          fontSize: 11,
        }}>
          {shortName(selected || models[0])}
        </span>
        <ChevronDown style={{
          width: 13,
          height: 13,
          color: "var(--muted)",
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform 0.15s ease",
          flexShrink: 0,
        }} />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          right: 0,
          marginBottom: 6,
          background: "var(--bg-alt)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 4,
          minWidth: 260,
          maxHeight: 280,
          overflowY: "auto",
          zIndex: 100,
          boxShadow: "0 8px 32px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.1)",
        }}>
          {provider && (
            <div style={{
              padding: "6px 10px 4px",
              fontSize: 11,
              color: "var(--muted)",
              fontWeight: 600,
              letterSpacing: "0.3px",
              textTransform: "uppercase",
            }}>
              {provider}
            </div>
          )}
          {models.map((m) => (
            <button
              key={m}
              onClick={() => { onSelect(m); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                borderRadius: 8,
                border: "none",
                background: m === selected ? "rgba(99,179,237,0.12)" : "transparent",
                color: m === selected ? "var(--accent)" : "var(--text)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "monospace",
                transition: "background 0.1s ease",
              }}
              onMouseEnter={(e) => { if (m !== selected) e.currentTarget.style.background = "var(--surface-hover)"; }}
              onMouseLeave={(e) => { if (m !== selected) e.currentTarget.style.background = "transparent"; }}
            >
              {m === selected && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AiChatTab({ guildId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeProvider, setActiveProvider] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  async function sendMessage(text) {
    const content = (text || input).trim();
    if (!content || isStreaming) return;

    const token = getToken();
    if (!token) {
      setMessages(prev => [
        ...prev,
        {
          _id: crypto.randomUUID(),
          role: "assistant",
          content: "Error: dashboard session expired. Sign in again.",
          isStreaming: false,
        },
      ]);
      return;
    }

    setInput("");
    setIsStreaming(true);

    const userMsg = { _id: crypto.randomUUID(), role: "user", content };
    const history = messages
      .filter(m => (m.role === "user" || m.role === "assistant") && !m.isStreaming && m.content)
      .map(m => ({ role: m.role, content: m.content }))
      .slice(-12);
    setMessages(prev => [...prev, userMsg]);

    const botMsg = { _id: crypto.randomUUID(), role: "assistant", content: "", isStreaming: true, tools: [], provider: null };
    setMessages(prev => [...prev, botMsg]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(BASE + "/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: content,
          history,
          guildId: guildId || undefined,
          model: selectedModel || undefined,
        }),
        signal: controller.signal,
      });

      if (res.status === 401) clearToken();
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("Streaming is not available in this browser.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(trimmed.slice(6));
            switch (data.type) {
              case "meta":
                setMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, provider: data.providerId || null, model: data.model || null } : m
                ));
                break;
              case "token":
                setMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: m.content + data.text } : m
                ));
                break;
              case "done":
                setMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1
                    ? {
                        ...m,
                        isStreaming: false,
                        fullText: data.fullText,
                        provider: data.providerId || m.provider,
                        model: data.model || m.model,
                      }
                    : m
                ));
                done = true;
                break;
              case "error":
                setMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: `Error: ${data.error}`, isStreaming: false } : m
                ));
                done = true;
                break;
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1
            ? { ...m, content: m.content || "Stopped.", isStreaming: false }
            : m
        ));
        return;
      }
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: `Error: ${err.message}`, isStreaming: false } : m
      ));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
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
      if (d.models) setModels(d.models);
      if (d.model) setSelectedModel(d.model);
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchProvider(); }, [guildId]);

  function clearChat() {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
  }

  function stopStreaming() {
    if (abortRef.current) abortRef.current.abort();
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="tab active" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)" }}>
      {/* Top bar */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: hasMessages ? "1px solid var(--border)" : "none",
        marginBottom: hasMessages ? 12 : 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {activeProvider && (
            <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Cpu style={{ width: 12, height: 12 }} /> {activeProvider}
            </span>
          )}
        </div>
        {hasMessages && (
          <button className="btn danger" onClick={clearChat} disabled={isStreaming} style={{ padding: "4px 10px", fontSize: 12 }}>
            <Trash2 style={{ width: 14, height: 14 }} /> New chat
          </button>
        )}
      </div>

      {/* Chat area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {!hasMessages ? (
          <EmptyState onSuggestion={(s) => { setInput(s); sendMessage(s); }} />
        ) : (
          <div style={{ maxWidth: 700, margin: "0 auto", padding: "16px 0", width: "100%" }}>
            {messages.map((msg) => (
              <ChatMessage key={msg._id} msg={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{
        padding: "12px 0",
        borderTop: hasMessages ? "1px solid var(--border)" : "none",
      }}>
        <div style={{
          maxWidth: hasMessages ? 700 : 560,
          margin: "0 auto",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 6px 6px 18px",
            borderRadius: 24,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            transition: "border-color 0.15s ease",
          }}
          >
            <input
              ref={inputRef}
              placeholder={isStreaming ? "Waiting for response..." : "Message AI playground..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              disabled={isStreaming}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                color: "var(--text)",
                fontSize: 15,
                outline: "none",
                padding: "8px 0",
              }}
            />
            <ModelPicker
              models={models}
              selected={selectedModel}
              onSelect={setSelectedModel}
              provider={activeProvider}
            />
            <button
              onClick={isStreaming ? stopStreaming : () => sendMessage()}
              disabled={!isStreaming && !input.trim()}
              title={isStreaming ? "Stop" : "Send"}
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: "none",
                background: (input.trim() && !isStreaming) || isStreaming ? "var(--accent)" : "var(--surface-hover)",
                color: (input.trim() && !isStreaming) || isStreaming ? "#fff" : "var(--muted)",
                cursor: (input.trim() && !isStreaming) || isStreaming ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}
            >
              {isStreaming ? <Square style={{ width: 14, height: 14 }} /> : <Send style={{ width: 16, height: 16 }} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
