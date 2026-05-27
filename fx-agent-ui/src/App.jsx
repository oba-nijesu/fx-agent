import { useState, useEffect, useRef, useCallback, Component } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const CORRIDORS = [
  { value: "GBP>NGN", label: "GBP → NGN" }, { value: "USD>NGN", label: "USD → NGN" },
  { value: "EUR>NGN", label: "EUR → NGN" }, { value: "CAD>NGN", label: "CAD → NGN" },
  { value: "AED>NGN", label: "AED → NGN" }, { value: "AUD>NGN", label: "AUD → NGN" },
  { value: "CHF>NGN", label: "CHF → NGN" }, { value: "USD>GHS", label: "USD → GHS" },
  { value: "GBP>GHS", label: "GBP → GHS" }, { value: "EUR>GHS", label: "EUR → GHS" },
  { value: "USD>XOF", label: "USD → XOF" }, { value: "EUR>XOF", label: "EUR → XOF" },
  { value: "USD>KES", label: "USD → KES" }, { value: "GBP>KES", label: "GBP → KES" },
  { value: "USD>TZS", label: "USD → TZS" }, { value: "USD>UGX", label: "USD → UGX" },
  { value: "USD>ZAR", label: "USD → ZAR" }, { value: "GBP>ZAR", label: "GBP → ZAR" },
];

const PROVIDERS = [
  "Stanbic IBTC", "Access Bank", "Fidelity Bank", "Ecobank",
  "Verto FX", "Flutterwave", "Wise", "Nium", "Airwallex", "SWIFT",
];

const SUGGESTS = [
  "NGN rate outlook for GBP corridor",
  "Which corridor had the highest FX markup?",
  "Compare Wise vs Ecobank spreads",
  "Should I send large volume now or wait?",
  "Best provider for USD→NGN today?",
];

// ── Error boundary ────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, textAlign: "center", fontFamily: "system-ui", marginTop: 60 }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: "#e53e3e", fontWeight: 600 }}>Something went wrong</div>
        <div style={{ color: "#999", fontSize: 13, marginTop: 8, marginBottom: 20 }}>
          {this.state.error.message}
        </div>
        <button onClick={() => window.location.reload()} style={{
          background: "#E1F5EE", border: "1px solid #1D9E75",
          borderRadius: 8, padding: "7px 20px", fontSize: 13,
          color: "#0F6E56", cursor: "pointer", fontFamily: "inherit",
        }}>Reload</button>
      </div>
    );
    return this.props.children;
  }
}

// ── Helpers ───────────────────────────────────────────────────
const getTenantId = () => {
  let id = localStorage.getItem("fx_tenant_id");
  if (!id) {
    id = `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("fx_tenant_id", id);
  }
  return id;
};

const newSessionId = () =>
  `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const corridorLabel = (value) =>
  CORRIDORS.find((c) => c.value === value)?.label || value;

// ── Onboarding ────────────────────────────────────────────────
function Onboarding({ serverUp, onRetry, onComplete }) {
  const [step, setStep]           = useState(1);
  const [company, setCompany]     = useState("");
  const [corridors, setCorridors] = useState([]);
  const [providers, setProviders] = useState([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (step === 1 && inputRef.current) inputRef.current.focus();
  }, [step]);

  const toggleCorridor = (c) =>
    setCorridors((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]);
  const toggleProvider = (p) =>
    setProviders((p2) => p2.includes(p) ? p2.filter((x) => x !== p) : [...p2, p]);

  const finish = async () => {
    if (providers.length === 0) { setError("Select at least one provider."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: getTenantId(),
          company_name: company.trim(),
          corridors,
          providers,
          spread_threshold: 3.0,
          alert_email: "",
        }),
      });
      if (!res.ok) throw new Error("Failed to save config.");
      onComplete({ company: company.trim(), corridors, providers });
    } catch (e) {
      setError(
        e.message === "Failed to fetch"
          ? "Cannot reach server. Start it: uvicorn server:app --reload --port 8000"
          : e.message
      );
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (step === 1 && !company.trim()) { setError("Please enter your company name."); return; }
    if (step === 2 && corridors.length === 0) { setError("Select at least one corridor."); return; }
    if (step === 3) { finish(); return; }
    setError(""); setStep((s) => s + 1);
  };

  const StepDot = ({ n }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: step >= n ? "#1D9E75" : "#ddd",
        boxShadow: step === n ? "0 0 0 3px #9FE1CB55" : "none",
        transition: "all 0.2s",
      }} />
      <span style={{ fontSize: 12, color: step === n ? "#555" : "#aaa" }}>
        {["Company", "Corridors", "Providers"][n - 1]}
      </span>
    </div>
  );

  const Chip = ({ label, active, onClick }) => (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 20, cursor: "pointer",
      fontSize: 13, fontFamily: "inherit", transition: "all 0.15s",
      border: `1px solid ${active ? "#1D9E75" : "#ddd"}`,
      background: active ? "#E1F5EE" : "#f9f9f9",
      color: active ? "#0F6E56" : "#555",
    }}>{label}</button>
  );

  return (
    <div style={{
      padding: 28, display: "flex", flexDirection: "column", gap: 20,
      background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12,
      maxWidth: 560, margin: "32px auto", fontFamily: "system-ui, sans-serif",
    }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 500, color: "#111" }}>FXAgent</div>
        <div style={{ fontSize: 12, color: "#aaa", fontFamily: "monospace", marginTop: 3 }}>
          Nigerian fintech edition
        </div>
      </div>

      {serverUp === false && (
        <div style={{
          background: "#fff5f5", border: "1px solid #fc8181",
          borderRadius: 8, padding: "10px 14px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, color: "#e53e3e" }}>
            ⚠ Server not running —{" "}
            <code style={{ fontSize: 12 }}>uvicorn server:app --reload --port 8000</code>
          </span>
          <button onClick={onRetry} style={{
            marginLeft: 12, background: "none", border: "1px solid #fc8181",
            borderRadius: 6, padding: "3px 10px", fontSize: 12,
            color: "#e53e3e", cursor: "pointer", whiteSpace: "nowrap",
          }}>Retry</button>
        </div>
      )}
      {serverUp === true && (
        <div style={{
          background: "#f0fdf4", border: "1px solid #68d391",
          borderRadius: 8, padding: "8px 14px",
          display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#276749",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#1D9E75" }} />
          Server connected
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StepDot n={1} />
        <div style={{ flex: 1, height: 1, background: step > 1 ? "#1D9E75" : "#e0e0e0" }} />
        <StepDot n={2} />
        <div style={{ flex: 1, height: 1, background: step > 2 ? "#1D9E75" : "#e0e0e0" }} />
        <StepDot n={3} />
      </div>

      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: "#111" }}>Welcome to FXAgent</h2>
            <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6, marginTop: 6 }}>
              Set up your workspace in 3 steps. Personalises the agent for your corridors and providers.
            </p>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 6 }}>
              Company name
            </label>
            <input
              ref={inputRef}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder="e.g. Lemfi, Grey, Cleva…"
              style={{
                width: "100%", padding: "8px 12px", fontSize: 14,
                borderRadius: 8, border: "1px solid #ddd",
                fontFamily: "inherit", color: "#111",
              }}
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: "#111" }}>Your active corridors</h2>
            <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6, marginTop: 6 }}>
              Select every corridor your company operates.
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CORRIDORS.map((c) => (
              <Chip key={c.value} label={c.label}
                active={corridors.includes(c.value)}
                onClick={() => toggleCorridor(c.value)} />
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#aaa" }}>{corridors.length} selected</p>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: "#111" }}>Your liquidity providers</h2>
            <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6, marginTop: 6 }}>
              Who do you source FX liquidity from?
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PROVIDERS.map((p) => (
              <Chip key={p} label={p}
                active={providers.includes(p)}
                onClick={() => toggleProvider(p)} />
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#aaa" }}>{providers.length} selected</p>
          {providers.length > 0 && company && (
            <div style={{
              background: "#f5f5f5", border: "1px solid #e0e0e0",
              borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#555", lineHeight: 1.8,
            }}>
              <strong style={{ color: "#111" }}>{company}</strong><br />
              Corridors: {corridors.map(corridorLabel).join(", ")}<br />
              Providers: {providers.join(", ")}
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: "#e53e3e", fontSize: 13, margin: 0 }}>{error}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        {step > 1 ? (
          <button onClick={() => { setError(""); setStep((s) => s - 1); }} style={{
            background: "none", border: "1px solid #ddd", borderRadius: 8,
            padding: "7px 16px", fontSize: 13, color: "#555",
            cursor: "pointer", fontFamily: "inherit",
          }}>← Back</button>
        ) : <div />}
        <button onClick={next} disabled={saving} style={{
          background: "#E1F5EE", border: "1px solid #1D9E75", borderRadius: 8,
          padding: "7px 20px", fontSize: 13, fontWeight: 500,
          color: saving ? "#aaa" : "#0F6E56",
          cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit",
        }}>
          {saving ? "Setting up…" : step < 3 ? "Continue →" : "Get started →"}
        </button>
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────
function Message({ role, text }) {
  const isUser = role === "user";
  const html = !isUser
    ? text
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/#{1,3} (.*?)(\n|$)/g, "<strong>$1</strong>")
    : null;
  return (
    <div style={{
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: isUser ? "72%" : "85%",
      background: isUser ? "#E1F5EE" : "#fff",
      color: isUser ? "#0F6E56" : "#111",
      border: isUser ? "1px solid #1D9E75" : "1px solid #e0e0e0",
      borderRadius: isUser ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
      padding: "8px 13px", fontSize: 14, lineHeight: 1.6,
      whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}>
      {isUser ? text : <span dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────
function Typing() {
  return (
    <div style={{
      alignSelf: "flex-start", background: "#fff",
      border: "1px solid #e0e0e0", borderRadius: "2px 12px 12px 12px",
      padding: "10px 14px", display: "flex", gap: 5,
    }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: "#ccc",
          display: "block", animation: `blink 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`@keyframes blink{0%,60%,100%{opacity:.25}30%{opacity:1}}`}</style>
    </div>
  );
}

// ── Chat UI ───────────────────────────────────────────────────
function Chat({ config, onReset }) {
  const tenantId = getTenantId();
  const [sessionId]   = useState(() => newSessionId());
  const { company, corridors, providers } = config;
  const labels = corridors.map(corridorLabel);

  const welcome = `Hey! I'm FXAgent.\n\nI'm set up for ${company}. I can analyse your diaspora remittance corridors (${labels.join(", ")}), compare your providers (${providers.join(", ")}), track FX spreads and markup costs, and give you the NGN official vs parallel rate picture.\n\nWhat would you like to know?`;

  const [msgs, setMsgs]       = useState([{ role: "agent", text: welcome }]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const bottomRef = useRef(null);
  const taRef     = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  const send = async (override) => {
    const text = override || input.trim();
    if (!text || loading) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setMsgs((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId, tenant_id: tenantId }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || "Server error");
      }
      const data = await res.json();
      setMsgs((prev) => [...prev, { role: "agent", text: data.answer }]);
    } catch (e) {
      const isNetwork = e.message === "Failed to fetch" || e instanceof TypeError;
      setError(isNetwork ? "disconnected" : e.message);
      setMsgs((prev) => [...prev, {
        role: "agent",
        text: `⚠️ ${isNetwork ? "Server not reachable. Run: uvicorn server:app --reload --port 8000" : e.message}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const autosize = (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px";
  };

  const handleReset = () => {
    localStorage.removeItem("fx_tenant_id");
    onReset();
  };

  return (
    <div style={{
      display: "flex", height: "100vh", overflow: "hidden",
      background: "#fff", fontFamily: "system-ui, sans-serif",
    }}>
      <style>{`* { box-sizing: border-box; } body { margin: 0; } textarea { outline: none; resize: none; }`}</style>

      {/* Sidebar */}
      <div style={{
        width: 210, borderRight: "1px solid #e0e0e0",
        display: "flex", flexDirection: "column",
        background: "#fafafa", flexShrink: 0,
      }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #e0e0e0" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>{company}</div>
          <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace", marginTop: 2 }}>
            FXAgent workspace
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Active corridors
          </div>
          {labels.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: "#555", padding: "3px 0", display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#1D9E75", flexShrink: 0 }} />{c}
            </div>
          ))}

          <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, marginTop: 14 }}>
            Providers
          </div>
          {providers.map((p) => (
            <div key={p} style={{ fontSize: 13, color: "#555", padding: "3px 0", display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#BA7517", flexShrink: 0 }} />{p}
            </div>
          ))}
        </div>

        <div style={{ padding: "10px 14px", borderTop: "1px solid #e0e0e0" }}>
          <button onClick={handleReset} style={{
            background: "none", border: "none", color: "#aaa", fontSize: 12,
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 5,
          }}>⚙ Reset workspace</button>
        </div>
      </div>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid #e0e0e0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>FXAgent</div>
            <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace", marginTop: 2 }}>
              Cross-border & diaspora remittance
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: error ? "#e53e3e" : "#aaa" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: error ? "#fc8181" : "#1D9E75" }} />
            {error ? "disconnected" : "live"}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs.map((m, i) => <Message key={i} role={m.role} text={m.text} />)}
          {loading && <Typing />}
          <div ref={bottomRef} />
        </div>

        {msgs.length <= 1 && !loading && (
          <div style={{ padding: "0 14px 8px", display: "flex", flexWrap: "wrap", gap: 5 }}>
            {SUGGESTS.map((s, i) => (
              <button key={i} onClick={() => send(s)} style={{
                padding: "4px 10px", borderRadius: 20, border: "1px solid #ddd",
                background: "#f9f9f9", color: "#555", fontSize: 12,
                cursor: "pointer", fontFamily: "inherit",
              }}>{s}</button>
            ))}
          </div>
        )}

        <div style={{
          padding: "10px 14px", borderTop: "1px solid #e0e0e0",
          display: "flex", gap: 8, alignItems: "flex-end",
        }}>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autosize(e); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Ask about rates, corridors, providers…"
            style={{
              flex: 1, border: "1px solid #ddd", borderRadius: 8,
              padding: "8px 11px", fontFamily: "inherit", fontSize: 14,
              minHeight: 36, maxHeight: 96, background: "#fff", color: "#111",
            }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            style={{
              width: 36, height: 36, borderRadius: 8, border: "1px solid #ddd",
              background: "#fff", fontSize: 16,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              opacity: loading || !input.trim() ? 0.35 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >→</button>
        </div>
      </div>
    </div>
  );
}

// ── Root app ──────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState(null);
  const [ready, setReady]   = useState(false);
  const [serverUp, setServerUp] = useState(null);

  const checkServer = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      setServerUp(r.ok);
      return r.ok;
    } catch {
      setServerUp(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const tenantId = getTenantId();
    checkServer().then((up) => {
      if (!up) { setReady(true); return; }
      fetch(`${API_BASE}/config/${tenantId}`)
        .then((r) => { if (r.ok) return r.json(); throw new Error("not configured"); })
        .then((cfg) => setConfig({ company: cfg.company_name, corridors: cfg.corridors, providers: cfg.providers }))
        .catch(() => {})
        .finally(() => setReady(true));
    });
  }, [checkServer]);

  if (!ready) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ color: "#aaa", fontSize: 14 }}>Loading…</div>
    </div>
  );

  if (!config) return (
    <ErrorBoundary>
      <Onboarding
        serverUp={serverUp}
        onRetry={async () => { const up = await checkServer(); if (up) window.location.reload(); }}
        onComplete={(cfg) => setConfig(cfg)}
      />
    </ErrorBoundary>
  );

  return (
    <ErrorBoundary>
      <Chat config={config} onReset={() => setConfig(null)} />
    </ErrorBoundary>
  );
}
