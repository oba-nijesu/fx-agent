import { useState, useEffect, useRef, useCallback, Component } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

// Dark theme tokens
const T = {
  bg:       "#0a0a0f",
  surface:  "#111118",
  border:   "#1e1e2a",
  border2:  "#252532",
  text:     "#e8e8f0",
  muted:    "#888899",
  faint:    "#444455",
  accent:   "#00d4aa",
  accentDim:"#00d4aa22",
  accentBorder:"#00d4aa55",
  gold:     "#f0a030",
  red:      "#ff5555",
  redDim:   "#ff555522",
  redBorder:"#ff555544",
};

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
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
          <div style={{ color: T.red, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ color: T.faint, fontSize: 13, marginBottom: 24 }}>{this.state.error.message}</div>
          <button onClick={() => window.location.reload()} style={{ background: T.accentDim, border: `1px solid ${T.accentBorder}`, borderRadius: 8, padding: "8px 20px", fontSize: 13, color: T.accent, cursor: "pointer" }}>
            Reload
          </button>
        </div>
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

const corridorLabel = (v) => CORRIDORS.find((c) => c.value === v)?.label || v;

// ── Onboarding ────────────────────────────────────────────────
function Onboarding({ serverUp, waking, onRetry, onComplete }) {
  const [step, setStep]           = useState(1);
  const [company, setCompany]     = useState("");
  const [corridors, setCorridors] = useState([]);
  const [providers, setProviders] = useState([]);
  const [customPair, setCustomPair] = useState("");
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

  const addCustomPair = () => {
    const val = customPair.trim().toUpperCase().replace(/[→\-\s]+/g, ">");
    if (!val || !val.includes(">")) return;
    if (!corridors.includes(val)) setCorridors((p) => [...p, val]);
    setCustomPair("");
  };

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
          corridors, providers,
          spread_threshold: 3.0,
          alert_email: "",
        }),
      });
      if (!res.ok) throw new Error("Failed to save config.");
      onComplete({ company: company.trim(), corridors, providers });
    } catch (e) {
      setError(
        e.message === "Failed to fetch"
          ? "Cannot reach server. Click Retry — it may still be waking up."
          : e.message
      );
    } finally { setSaving(false); }
  };

  const next = () => {
    if (step === 1 && !company.trim()) { setError("Please enter your company name."); return; }
    if (step === 2 && corridors.length === 0) { setError("Select at least one currency pair."); return; }
    if (step === 3) { finish(); return; }
    setError(""); setStep((s) => s + 1);
  };

  const Chip = ({ label, active, onClick }) => (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 20, cursor: "pointer",
      fontSize: 13, fontFamily: "inherit", transition: "all 0.15s",
      border: `1px solid ${active ? T.accent : T.border2}`,
      background: active ? T.accentDim : T.surface,
      color: active ? T.accent : T.muted,
    }}>{label}</button>
  );

  const stepLabels = ["Company", "Currency Pairs", "Providers"];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <style>{`input,button{font-family:inherit} input:focus{outline:2px solid ${T.accent};outline-offset:0} input{box-sizing:border-box}`}</style>

      <div style={{ width: "100%", maxWidth: 560, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Logo */}
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: T.text }}>FXAgent</div>
          <div style={{ fontSize: 12, color: T.accent, fontFamily: "monospace", marginTop: 3 }}>Nigerian fintech edition</div>
        </div>

        {/* Server banner */}
        {waking && (
          <div style={{ background: "#0a1a30", border: "1px solid #2255aa44", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#6699dd" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4488cc", animation: "pulse 1.2s infinite" }} />
            Waking up server… this takes ~30s on first load
          </div>
        )}
        {!waking && serverUp === false && (
          <div style={{ background: T.redDim, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: T.red }}>
              ⚠ Server not reachable — <code style={{ fontSize: 12 }}>uvicorn server:app --reload --port 8000</code>
            </span>
            <button onClick={onRetry} style={{ marginLeft: 12, background: "none", border: `1px solid ${T.red}`, borderRadius: 6, padding: "3px 10px", fontSize: 12, color: T.red, cursor: "pointer", whiteSpace: "nowrap" }}>Retry</button>
          </div>
        )}
        {!waking && serverUp === true && (
          <div style={{ background: "#0a1a14", border: `1px solid ${T.accentBorder}`, borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.accent }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent }} />
            Server connected
          </div>
        )}

        {/* Step dots */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {stepLabels.map((label, i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, flex: i < 2 ? "1" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: step >= i + 1 ? T.accent : T.faint, boxShadow: step === i + 1 ? `0 0 0 3px ${T.accentDim}` : "none", transition: "all 0.2s" }} />
                <span style={{ fontSize: 12, color: step === i + 1 ? T.text : T.faint }}>{label}</span>
              </div>
              {i < 2 && <div style={{ flex: 1, height: 1, background: step > i + 1 ? T.accent : T.border }} />}
            </div>
          ))}
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: T.text, margin: 0 }}>Welcome to FXAgent</h2>
              <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>
                Set up your workspace in 3 steps. Personalises the agent for your corridors and providers.
              </p>
            </div>
            <div>
              <label style={{ fontSize: 13, color: T.muted, display: "block", marginBottom: 8 }}>Company name</label>
              <input
                ref={inputRef} value={company}
                onChange={(e) => setCompany(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && next()}
                placeholder="e.g. Lemfi, Grey, Cleva…"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 8, border: `1px solid ${T.border2}`, background: T.bg, color: T.text }}
              />
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: T.text, margin: 0 }}>Your active currency pairs</h2>
              <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>Select every currency pair your company operates, or type a custom one.</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CORRIDORS.map((c) => (
                <Chip key={c.value} label={c.label} active={corridors.includes(c.value)} onClick={() => toggleCorridor(c.value)} />
              ))}
            </div>
            {/* Custom pair input */}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={customPair}
                onChange={(e) => setCustomPair(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomPair()}
                placeholder="e.g. NGN>ZAR or GBP>USD"
                style={{ flex: 1, padding: "7px 11px", fontSize: 13, borderRadius: 8, border: `1px solid ${T.border2}`, background: T.bg, color: T.text, fontFamily: "monospace" }}
              />
              <button onClick={addCustomPair} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.accentBorder}`, background: T.accentDim, color: T.accent, fontSize: 13, cursor: "pointer" }}>
                Add
              </button>
            </div>
            {/* Custom pairs added */}
            {corridors.filter(c => !CORRIDORS.find(x => x.value === c)).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {corridors.filter(c => !CORRIDORS.find(x => x.value === c)).map((c) => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 20, border: `1px solid ${T.accentBorder}`, background: T.accentDim, fontSize: 13, color: T.accent, fontFamily: "monospace" }}>
                    {c}
                    <button onClick={() => toggleCorridor(c)} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 14, padding: "0 0 0 4px", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: 12, color: T.faint, margin: 0 }}>{corridors.length} selected</p>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: T.text, margin: 0 }}>Your liquidity providers</h2>
              <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>Who do you source FX liquidity from?</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PROVIDERS.map((p) => (
                <Chip key={p} label={p} active={providers.includes(p)} onClick={() => toggleProvider(p)} />
              ))}
            </div>
            <p style={{ fontSize: 12, color: T.faint, margin: 0 }}>{providers.length} selected</p>
            {providers.length > 0 && company && (
              <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 13, color: T.muted, lineHeight: 1.8 }}>
                <strong style={{ color: T.text }}>{company}</strong><br />
                Currency pairs: {corridors.map(corridorLabel).join(", ")}<br />
                Providers: {providers.join(", ")}
              </div>
            )}
          </div>
        )}

        {error && <p style={{ color: T.red, fontSize: 13, margin: 0 }}>{error}</p>}

        {/* Nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {step > 1 ? (
            <button onClick={() => { setError(""); setStep((s) => s - 1); }} style={{ background: "none", border: `1px solid ${T.border2}`, borderRadius: 8, padding: "8px 18px", fontSize: 13, color: T.muted, cursor: "pointer" }}>← Back</button>
          ) : <div />}
          <button onClick={next} disabled={saving} style={{ background: T.accentDim, border: `1px solid ${T.accentBorder}`, borderRadius: 8, padding: "8px 22px", fontSize: 13, fontWeight: 600, color: saving ? T.faint : T.accent, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Setting up…" : step < 3 ? "Continue →" : "Get started →"}
          </button>
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────
function Message({ role, text }) {
  const isUser = role === "user";
  const html = !isUser
    ? text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/#{1,3} (.*?)(\n|$)/g, "<strong>$1</strong>")
    : null;
  return (
    <div style={{
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: isUser ? "72%" : "85%",
      background: isUser ? T.accentDim : T.surface,
      color: isUser ? T.accent : T.text,
      border: `1px solid ${isUser ? T.accentBorder : T.border}`,
      borderRadius: isUser ? "14px 14px 2px 14px" : "2px 14px 14px 14px",
      padding: "9px 14px", fontSize: 14, lineHeight: 1.65,
      whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}>
      {isUser ? text : <span dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────
function Typing() {
  return (
    <div style={{ alignSelf: "flex-start", background: T.surface, border: `1px solid ${T.border}`, borderRadius: "2px 14px 14px 14px", padding: "11px 16px", display: "flex", gap: 5 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, display: "block", opacity: 0.4, animation: `blink 1.2s ${i * 0.2}s infinite` }} />
      ))}
      <style>{`@keyframes blink{0%,60%,100%{opacity:.2}30%{opacity:1}}`}</style>
    </div>
  );
}

// ── Chat UI ───────────────────────────────────────────────────
function Chat({ config, onReset }) {
  const tenantId       = getTenantId();
  const [sessionId]    = useState(() => newSessionId());
  const { company, corridors, providers } = config;
  const labels         = corridors.map(corridorLabel);

  const welcome = `Hey! I'm FXAgent 💱\n\nI'm set up for ${company}. I can analyse your diaspora remittance corridors (${labels.join(", ")}), compare your providers (${providers.join(", ")}), track FX spreads and markup costs, and give you the NGN official vs parallel rate picture.\n\nWhat would you like to know?`;

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
    setLoading(true); setError(null);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId, tenant_id: tenantId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Server error"); }
      const data = await res.json();
      setMsgs((prev) => [...prev, { role: "agent", text: data.answer }]);
    } catch (e) {
      const isNetwork = e.message === "Failed to fetch" || e instanceof TypeError;
      setError(isNetwork ? "disconnected" : e.message);
      setMsgs((prev) => [...prev, {
        role: "agent",
        text: `⚠️ ${isNetwork ? "Server not reachable. Check your connection or restart the backend." : e.message}`,
      }]);
    } finally { setLoading(false); }
  };

  const autosize = (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px";
  };

  const handleReset = () => { localStorage.removeItem("fx_tenant_id"); onReset(); };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: T.bg, fontFamily: "system-ui, sans-serif", color: T.text }}>
      <style>{`*{box-sizing:border-box} body{margin:0} textarea{outline:none;resize:none} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:${T.border2};border-radius:2px}`}</style>

      {/* Sidebar */}
      <div style={{ width: 220, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", background: T.surface, flexShrink: 0 }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{company}</div>
          <div style={{ fontSize: 11, color: T.accent, fontFamily: "monospace", marginTop: 3 }}>FXAgent workspace</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Currency pairs</div>
          {labels.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: T.muted, padding: "3px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.accent, flexShrink: 0 }} />{c}
            </div>
          ))}

          <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, marginTop: 16 }}>Providers</div>
          {providers.map((p) => (
            <div key={p} style={{ fontSize: 13, color: T.muted, padding: "3px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.gold, flexShrink: 0 }} />{p}
            </div>
          ))}
        </div>

        <div style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
          <button onClick={handleReset} style={{ background: "none", border: "none", color: T.faint, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            ⚙ Reset workspace
          </button>
        </div>
      </div>

      {/* Main chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "13px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: T.surface }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>FXAgent</div>
            <div style={{ fontSize: 11, color: T.muted, fontFamily: "monospace", marginTop: 2 }}>Cross-border & diaspora remittance</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: error ? T.red : T.muted }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: error ? T.red : T.accent, boxShadow: `0 0 6px ${error ? T.red : T.accent}` }} />
            {error ? "disconnected" : "live"}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs.map((m, i) => <Message key={i} role={m.role} text={m.text} />)}
          {loading && <Typing />}
          <div ref={bottomRef} />
        </div>

        {msgs.length <= 1 && !loading && (
          <div style={{ padding: "8px 16px", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SUGGESTS.map((s, i) => (
              <button key={i} onClick={() => send(s)} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${T.border2}`, background: T.surface, color: T.muted, fontSize: 12, cursor: "pointer" }}>{s}</button>
            ))}
          </div>
        )}

        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "flex-end", background: T.surface }}>
          <textarea
            ref={taRef} value={input}
            onChange={(e) => { setInput(e.target.value); autosize(e); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1} placeholder="Ask about rates, corridors, providers…"
            style={{ flex: 1, border: `1px solid ${T.border2}`, borderRadius: 10, padding: "9px 12px", fontSize: 14, minHeight: 38, maxHeight: 96, background: T.bg, color: T.text }}
          />
          <button onClick={() => send()} disabled={loading || !input.trim()} style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${T.border2}`, background: !loading && input.trim() ? T.accentDim : T.bg, fontSize: 16, cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.3 : 1, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: T.accent }}>
            →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Root app ──────────────────────────────────────────────────
export default function App() {
  const [config, setConfig]     = useState(null);
  const [ready, setReady]       = useState(false);
  const [serverUp, setServerUp] = useState(null);
  const [waking, setWaking]     = useState(false);

  const checkServer = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      // 60s timeout — Render free tier takes up to 50s to cold-start
      const t = setTimeout(() => ctrl.abort(), 60000);
      setWaking(true);
      const r = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      setWaking(false);
      setServerUp(r.ok);
      return r.ok;
    } catch {
      setWaking(false);
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
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", gap: 16 }}>
      <div style={{ width: 32, height: 32, border: `2px solid ${T.border2}`, borderTop: `2px solid ${T.accent}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      {waking && <div style={{ color: T.muted, fontSize: 13 }}>Waking up server… (~30s on first load)</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!config) return (
    <ErrorBoundary>
      <Onboarding
        serverUp={serverUp} waking={waking}
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
