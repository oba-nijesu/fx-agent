import { useState, useRef, useEffect, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

// ── Static options (hardcoded — no server fetch needed) ───────
const CORRIDOR_OPTIONS = [
  // Diaspora remittance into Nigeria
  { value: "GBP>NGN", label: "GBP → NGN", desc: "UK · Nigeria" },
  { value: "USD>NGN", label: "USD → NGN", desc: "US · Nigeria" },
  { value: "EUR>NGN", label: "EUR → NGN", desc: "EU · Nigeria" },
  { value: "CAD>NGN", label: "CAD → NGN", desc: "Canada · Nigeria" },
  { value: "AED>NGN", label: "AED → NGN", desc: "UAE · Nigeria" },
  { value: "AUD>NGN", label: "AUD → NGN", desc: "Australia · Nigeria" },
  { value: "CHF>NGN", label: "CHF → NGN", desc: "Switzerland · Nigeria" },
  // West Africa
  { value: "USD>GHS", label: "USD → GHS", desc: "US · Ghana" },
  { value: "GBP>GHS", label: "GBP → GHS", desc: "UK · Ghana" },
  { value: "EUR>GHS", label: "EUR → GHS", desc: "EU · Ghana" },
  { value: "USD>XOF", label: "USD → XOF", desc: "US · Francophone W. Africa" },
  { value: "EUR>XOF", label: "EUR → XOF", desc: "EU · Francophone W. Africa" },
  // East Africa
  { value: "USD>KES", label: "USD → KES", desc: "US · Kenya" },
  { value: "GBP>KES", label: "GBP → KES", desc: "UK · Kenya" },
  { value: "USD>TZS", label: "USD → TZS", desc: "US · Tanzania" },
  { value: "USD>UGX", label: "USD → UGX", desc: "US · Uganda" },
  // Southern Africa
  { value: "USD>ZAR", label: "USD → ZAR", desc: "US · South Africa" },
  { value: "GBP>ZAR", label: "GBP → ZAR", desc: "UK · South Africa" },
];

const PROVIDER_OPTIONS = [
  "Stanbic IBTC", "Access Bank", "Fidelity Bank", "Ecobank",
  "Verto FX", "Flutterwave", "Nium", "Wise", "Airwallex", "SWIFT",
];

// ── Helpers ───────────────────────────────────────────────────
const newSessionId = () =>
  `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getTenantId = () => {
  let id = localStorage.getItem("fx_tenant_id");
  if (!id) {
    id = `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("fx_tenant_id", id);
  }
  return id;
};

const WELCOME_MSG = (company) => ({
  role: "assistant",
  content: `Hey! I'm FXAgent 💱\n\nI'm set up for ${company || "your team"}. I can analyse your diaspora remittance corridors, compare liquidity providers, track FX spread and markup costs across your active corridors, and give you the NGN official vs parallel rate picture.\n\nWhat would you like to know?`,
});


// ── Onboarding screen ─────────────────────────────────────────
function OnboardingScreen({ onComplete, serverUp, onRetryConnection }) {
  const [step, setStep]         = useState(1); // 1=company, 2=corridors, 3=providers, 4=threshold
  const [companyName, setCompanyName] = useState("");
  const [alertEmail, setAlertEmail]   = useState("");
  const [corridors, setCorridors]     = useState([]);
  const [providers, setProviders]     = useState([]);
  const [threshold, setThreshold]     = useState("3.0");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  const toggleCorridor = (val) =>
    setCorridors((prev) =>
      prev.includes(val) ? prev.filter((c) => c !== val) : [...prev, val]
    );

  const toggleProvider = (val) =>
    setProviders((prev) =>
      prev.includes(val) ? prev.filter((p) => p !== val) : [...prev, val]
    );

  const handleFinish = async () => {
    if (!companyName.trim()) { setError("Please enter your company name."); setStep(1); return; }
    if (corridors.length === 0) { setError("Select at least one corridor."); setStep(2); return; }
    if (providers.length === 0) { setError("Select at least one provider."); setStep(3); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: getTenantId(),
          company_name: companyName.trim(),
          corridors,
          providers,
          spread_threshold: parseFloat(threshold) || 3.0,
          alert_email: alertEmail.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to save config.");
      onComplete(companyName.trim());
    } catch (e) {
      const isNetwork = e.message === "Failed to fetch" || e instanceof TypeError;
      setError(
        isNetwork
          ? "Cannot reach server. Make sure it's running: uvicorn server:app --reload --port 8000"
          : e.message
      );
    } finally {
      setSaving(false);
    }
  };

  const chip = (label, active, onClick) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: "20px",
        border: `1px solid ${active ? "#00d4aa" : "#252535"}`,
        background: active ? "#00d4aa18" : "#0f0f1e",
        color: active ? "#00d4aa" : "#888",
        fontSize: "13px",
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >{label}</button>
  );

  const steps = ["Company", "Corridors", "Providers", "Threshold"];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#08080f",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      padding: "24px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input:focus { outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
      `}</style>

      <div style={{ width: "100%", maxWidth: "560px" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
          <div style={{
            width: "44px", height: "44px",
            background: "linear-gradient(135deg, #00d4aa, #00a884)",
            borderRadius: "12px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "22px",
          }}>💱</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "18px" }}>FXAgent</div>
            <div style={{ color: "#00d4aa", fontSize: "11px", fontFamily: "monospace" }}>Nigerian Fintech Edition</div>
          </div>
        </div>

        {/* Server status banner */}
        {serverUp === false && (
          <div style={{
            background: "#1a0a0a", border: "1px solid #ff555544",
            borderRadius: "10px", padding: "10px 14px",
            marginBottom: "16px", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: "12px",
          }}>
            <div>
              <span style={{ color: "#ff5555", fontSize: "13px", fontWeight: 500 }}>⚠ Server not running</span>
              <span style={{ color: "#666", fontSize: "12px", marginLeft: "8px", fontFamily: "monospace" }}>
                uvicorn server:app --reload --port 8000
              </span>
            </div>
            <button onClick={onRetryConnection} style={{
              background: "#ff555522", border: "1px solid #ff555544",
              borderRadius: "6px", padding: "4px 10px",
              color: "#ff8888", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap",
            }}>Retry</button>
          </div>
        )}
        {serverUp === true && (
          <div style={{
            background: "#0a1a12", border: "1px solid #00d4aa33",
            borderRadius: "10px", padding: "8px 14px",
            marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px",
          }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#00d4aa" }} />
            <span style={{ color: "#00d4aa", fontSize: "12px" }}>Server connected</span>
          </div>
        )}

        {/* Step indicator */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "28px" }}>
          {steps.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{
                width: "24px", height: "24px", borderRadius: "50%",
                background: i + 1 <= step ? "linear-gradient(135deg, #00d4aa, #00a884)" : "#1a1a2a",
                border: `1px solid ${i + 1 <= step ? "#00d4aa" : "#252535"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "11px", fontWeight: 600,
                color: i + 1 <= step ? "#000" : "#555",
                transition: "all 0.3s",
              }}>{i + 1}</div>
              <span style={{ color: i + 1 === step ? "#e0e0f0" : "#444", fontSize: "12px" }}>{s}</span>
              {i < steps.length - 1 && (
                <div style={{ width: "20px", height: "1px", background: i + 1 < step ? "#00d4aa44" : "#1a1a2a" }} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div style={{
          background: "#0a0a14",
          border: "1px solid #1a1a2a",
          borderRadius: "16px",
          padding: "28px",
        }}>
          {/* Step 1 — Company name */}
          {step === 1 && (
            <div>
              <h2 style={{ color: "#fff", fontSize: "18px", fontWeight: 600, marginBottom: "6px" }}>
                Welcome to FXAgent
              </h2>
              <p style={{ color: "#666", fontSize: "14px", marginBottom: "24px", lineHeight: 1.6 }}>
                Let's set up your workspace. This takes 2 minutes and personalises the agent for your corridors and providers.
              </p>
              <label style={{ color: "#aaa", fontSize: "13px", display: "block", marginBottom: "8px" }}>
                Company name
              </label>
              <input
                autoFocus
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && companyName.trim() && setStep(2)}
                placeholder="e.g. Lemfi, Grey, Cleva..."
                style={{
                  width: "100%",
                  background: "#0f0f1e",
                  border: "1px solid #252535",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  color: "#e0e0f0",
                  fontSize: "15px",
                  fontFamily: "inherit",
                }}
              />
              <label style={{ color: "#aaa", fontSize: "13px", display: "block", marginTop: "16px", marginBottom: "8px" }}>
                Alert email <span style={{ color: "#555" }}>(optional — for spread alerts)</span>
              </label>
              <input
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                placeholder="treasury@yourcompany.com"
                style={{
                  width: "100%",
                  background: "#0f0f1e",
                  border: "1px solid #252535",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  color: "#e0e0f0",
                  fontSize: "15px",
                  fontFamily: "inherit",
                }}
              />
            </div>
          )}

          {/* Step 2 — Corridors */}
          {step === 2 && (
            <div>
              <h2 style={{ color: "#fff", fontSize: "18px", fontWeight: 600, marginBottom: "6px" }}>
                Your active corridors
              </h2>
              <p style={{ color: "#666", fontSize: "14px", marginBottom: "20px", lineHeight: 1.6 }}>
                Select every payment corridor your company operates, or type a custom one below.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {CORRIDOR_OPTIONS.map((c) => (
                  <div key={c.value} onClick={() => toggleCorridor(c.value)} style={{ cursor: "pointer" }}>
                    <div style={{
                      padding: "10px 14px", borderRadius: "10px",
                      border: `1px solid ${corridors.includes(c.value) ? "#00d4aa" : "#252535"}`,
                      background: corridors.includes(c.value) ? "#00d4aa12" : "#0f0f1e",
                      transition: "all 0.15s",
                    }}>
                      <div style={{ color: corridors.includes(c.value) ? "#00d4aa" : "#e0e0f0", fontSize: "13px", fontWeight: 500 }}>
                        {c.label}
                      </div>
                      <div style={{ color: "#555", fontSize: "11px", marginTop: "2px" }}>{c.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Custom corridor input */}
              <div style={{ marginTop: "16px" }}>
                <p style={{ color: "#555", fontSize: "12px", marginBottom: "8px" }}>
                  Don't see yours? Type a custom corridor (e.g. USD&gt;TZS):
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    id="custom-corridor"
                    placeholder="e.g. USD>TZS"
                    style={{
                      flex: 1, background: "#0f0f1e", border: "1px solid #252535",
                      borderRadius: "8px", padding: "8px 12px",
                      color: "#e0e0f0", fontSize: "13px", fontFamily: "monospace",
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = e.target.value.trim().toUpperCase().replace(/[→\-\s]/g, ">");
                        if (val && val.includes(">") && !corridors.includes(val)) {
                          setCorridors((prev) => [...prev, val]);
                          e.target.value = "";
                        }
                      }
                    }}
                  />
                  <button onClick={() => {
                    const input = document.getElementById("custom-corridor");
                    const val = input.value.trim().toUpperCase().replace(/[→\-\s]/g, ">");
                    if (val && val.includes(">") && !corridors.includes(val)) {
                      setCorridors((prev) => [...prev, val]);
                      input.value = "";
                    }
                  }} style={{
                    padding: "8px 16px", borderRadius: "8px",
                    background: "#141420", border: "1px solid #252535",
                    color: "#00d4aa", fontSize: "13px", cursor: "pointer",
                  }}>Add</button>
                </div>
              </div>

              {corridors.length > 0 && (
                <p style={{ color: "#00d4aa", fontSize: "12px", marginTop: "12px" }}>
                  {corridors.length} corridor{corridors.length > 1 ? "s" : ""} selected
                </p>
              )}
            </div>
          )}

          {/* Step 3 — Providers */}
          {step === 3 && (
            <div>
              <h2 style={{ color: "#fff", fontSize: "18px", fontWeight: 600, marginBottom: "6px" }}>
                Your liquidity providers
              </h2>
              <p style={{ color: "#666", fontSize: "14px", marginBottom: "20px", lineHeight: 1.6 }}>
                Who do you source FX liquidity from? The agent will analyse provider performance and recommend switching.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {PROVIDER_OPTIONS.map((p) =>
                  chip(p, providers.includes(p), () => toggleProvider(p))
                )}
              </div>
              {providers.length > 0 && (
                <p style={{ color: "#00d4aa", fontSize: "12px", marginTop: "12px" }}>
                  {providers.length} provider{providers.length > 1 ? "s" : ""} selected
                </p>
              )}
            </div>
          )}

          {/* Step 4 — Spread threshold */}
          {step === 4 && (
            <div>
              <h2 style={{ color: "#fff", fontSize: "18px", fontWeight: 600, marginBottom: "6px" }}>
                Spread alert threshold
              </h2>
              <p style={{ color: "#666", fontSize: "14px", marginBottom: "24px", lineHeight: 1.6 }}>
                The agent will proactively flag any corridor where the average spread exceeds this value. Industry standard for NGN corridors is 2.5–3.5%.
              </p>
              <label style={{ color: "#aaa", fontSize: "13px", display: "block", marginBottom: "8px" }}>
                Alert when spread exceeds (%)
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <input
                  type="number"
                  min="0.5" max="10" step="0.1"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  style={{
                    width: "120px",
                    background: "#0f0f1e",
                    border: "1px solid #252535",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    color: "#e0e0f0",
                    fontSize: "20px",
                    fontFamily: "monospace",
                    textAlign: "center",
                  }}
                />
                <span style={{ color: "#666", fontSize: "14px" }}>%</span>
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
                {["2.0", "2.5", "3.0", "3.5"].map((v) =>
                  chip(v + "%", threshold === v, () => setThreshold(v))
                )}
              </div>

              {/* Summary */}
              <div style={{
                marginTop: "24px",
                padding: "14px",
                background: "#0f0f1e",
                borderRadius: "10px",
                border: "1px solid #1a1a2a",
              }}>
                <p style={{ color: "#555", fontSize: "11px", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Your setup</p>
                <p style={{ color: "#e0e0f0", fontSize: "13px", marginBottom: "4px" }}>
                  <span style={{ color: "#00d4aa" }}>Company:</span> {companyName}
                </p>
                <p style={{ color: "#e0e0f0", fontSize: "13px", marginBottom: "4px" }}>
                  <span style={{ color: "#00d4aa" }}>Corridors:</span> {corridors.join(", ")}
                </p>
                <p style={{ color: "#e0e0f0", fontSize: "13px", marginBottom: "4px" }}>
                  <span style={{ color: "#00d4aa" }}>Providers:</span> {providers.join(", ")}
                </p>
                <p style={{ color: "#e0e0f0", fontSize: "13px", marginBottom: "4px" }}>
                  <span style={{ color: "#00d4aa" }}>Alert threshold:</span> {threshold}%
                </p>
                {alertEmail && (
                  <p style={{ color: "#e0e0f0", fontSize: "13px" }}>
                    <span style={{ color: "#00d4aa" }}>Alert email:</span> {alertEmail}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p style={{ color: "#ff5555", fontSize: "13px", marginTop: "14px" }}>{error}</p>
          )}

          {/* Navigation */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "28px" }}>
            {step > 1 ? (
              <button onClick={() => setStep((s) => s - 1)} style={{
                background: "none", border: "1px solid #252535",
                borderRadius: "10px", padding: "10px 20px",
                color: "#888", fontSize: "14px", cursor: "pointer",
              }}>← Back</button>
            ) : <div />}

            {step < 4 ? (
              <button
                onClick={() => {
                  if (step === 1 && !companyName.trim()) { setError("Please enter your company name."); return; }
                  if (step === 2 && corridors.length === 0) { setError("Select at least one corridor."); return; }
                  if (step === 3 && providers.length === 0) { setError("Select at least one provider."); return; }
                  setError("");
                  setStep((s) => s + 1);
                }}
                style={{
                  background: "linear-gradient(135deg, #00d4aa, #00a884)",
                  border: "none", borderRadius: "10px",
                  padding: "10px 24px",
                  color: "#000", fontSize: "14px",
                  fontWeight: 600, cursor: "pointer",
                }}
              >Continue →</button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving}
                style={{
                  background: saving ? "#1a1a2e" : "linear-gradient(135deg, #00d4aa, #00a884)",
                  border: "none", borderRadius: "10px",
                  padding: "10px 28px",
                  color: saving ? "#555" : "#000",
                  fontSize: "14px", fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >{saving ? "Setting up..." : "Get Started →"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Message bubble ────────────────────────────────────────────
const Message = ({ msg }) => {
  const isUser = msg.role === "user";
  if (isUser) return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
      <div style={{
        background: "linear-gradient(135deg, #00d4aa22, #00d4aa44)",
        border: "1px solid #00d4aa55",
        color: "#e8f5f2", padding: "10px 16px",
        borderRadius: "18px 18px 4px 18px",
        maxWidth: "75%", fontSize: "14px", lineHeight: 1.5,
      }}>{msg.content}</div>
    </div>
  );

  const renderContent = (text) =>
    text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/#{1,3} (.*?)(\n|$)/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "$1");

  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "8px",
          background: "linear-gradient(135deg, #00d4aa, #00a884)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "14px", flexShrink: 0, marginTop: "2px",
        }}>💱</div>
        <div
          style={{
            flex: 1, background: "#141420", border: "1px solid #252535",
            borderRadius: "4px 18px 18px 18px", padding: "12px 16px",
            fontSize: "14px", color: "#e0e0f0", lineHeight: 1.7, whiteSpace: "pre-wrap",
          }}
          dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
        />
      </div>
    </div>
  );
};

const TypingIndicator = () => (
  <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px" }}>
    <div style={{
      width: "32px", height: "32px", borderRadius: "8px",
      background: "linear-gradient(135deg, #00d4aa, #00a884)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "14px", flexShrink: 0,
    }}>💱</div>
    <div style={{
      background: "#141420", border: "1px solid #252535",
      borderRadius: "4px 18px 18px 18px", padding: "14px 18px",
      display: "flex", gap: "5px", alignItems: "center",
    }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: "7px", height: "7px", borderRadius: "50%", background: "#00d4aa",
          animation: `bounce 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  </div>
);


// ── Dashboard ─────────────────────────────────────────────────
function Dashboard({ companyName }) {
  const tenantId = getTenantId();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/dashboard/${tenantId}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tenantId]);

  const TEAL   = "#00d4aa";
  const RED    = "#ff5555";
  const DARK   = "#141420";
  const BORDER = "#1a1a2a";

  const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });

  const MetricCard = ({ label, value, sub, accent }) => (
    <div style={{
      background: DARK, border: `1px solid ${BORDER}`, borderRadius: "12px",
      padding: "20px 24px", flex: 1, minWidth: "160px",
    }}>
      <div style={{ color: "#555", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>{label}</div>
      <div style={{ color: accent || TEAL, fontSize: "26px", fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ color: "#444", fontSize: "11px", marginTop: "4px" }}>{sub}</div>}
    </div>
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "#0a0a14", border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "10px 14px" }}>
        <div style={{ color: "#888", fontSize: "11px", marginBottom: "4px" }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color || TEAL, fontSize: "13px", fontFamily: "monospace" }}>
            {p.name}: {fmt(p.value)}{p.name.includes("spread") || p.name.includes("Spread") ? "%" : ""}
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#08080f" }}>
      <div style={{ color: TEAL, fontFamily: "monospace", fontSize: "14px" }}>Loading dashboard...</div>
    </div>
  );

  if (!data) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#08080f" }}>
      <div style={{ color: "#ff5555", fontSize: "14px" }}>Failed to load dashboard data.</div>
    </div>
  );

  const m = data.metrics || {};
  const worstCorridor = data.corridors?.[0];
  const bestProvider  = data.providers?.[0];

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#08080f", padding: "28px 32px", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ color: "#fff", fontSize: "20px", fontWeight: 700, margin: 0 }}>FX Intelligence Dashboard</h1>
          <p style={{ color: "#444", fontSize: "13px", marginTop: "4px" }}>{companyName} · Last 90 days</p>
        </div>

        {/* Metric cards */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "28px" }}>
          <MetricCard label="Total Transactions" value={fmt(m.total_transactions)} sub="across all corridors" />
          <MetricCard label="Total Volume" value={fmt(m.total_volume)} sub="base currency units" />
          <MetricCard label="Avg Spread" value={`${fmt(m.avg_spread)}%`} sub={m.avg_spread > 3 ? "⚠ above 3% threshold" : "within threshold"} accent={m.avg_spread > 3 ? RED : TEAL} />
          <MetricCard label="Total Markup Cost" value={fmt(m.total_markup)} sub="revenue lost to spread" accent="#f0a500" />
        </div>

        {/* Charts row 1 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>

          {/* Volume by corridor */}
          <div style={{ background: DARK, border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ color: "#888", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "16px" }}>Volume by Corridor</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.corridors} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2a" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#444", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="corridor" tick={{ fill: "#888", fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="volume" name="Volume" fill={TEAL} radius={[0, 4, 4, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Spread trend */}
          <div style={{ background: DARK, border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ color: "#888", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "16px" }}>Avg Spread — Last 30 Days</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.spread_trend} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2a" />
                <XAxis dataKey="date" tick={{ fill: "#444", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(d) => d?.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#444", fontSize: 11 }} axisLine={false} tickLine={false}
                  domain={["auto", "auto"]} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="avg_spread" name="Avg Spread" stroke={TEAL} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Charts row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>

          {/* Provider comparison */}
          <div style={{ background: DARK, border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ color: "#888", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "16px" }}>Provider Avg Spread</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.providers} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2a" vertical={false} />
                <XAxis dataKey="provider" tick={{ fill: "#666", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#444", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="avg_spread" name="Avg Spread" fill="#7c6af7" radius={[4, 4, 0, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Markup cost by corridor */}
          <div style={{ background: DARK, border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "20px" }}>
            <div style={{ color: "#888", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "16px" }}>Markup Cost by Corridor</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.corridors} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2a" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#444", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="corridor" tick={{ fill: "#888", fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="markup_cost" name="Markup Cost" fill="#f0a500" radius={[0, 4, 4, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Insight strip */}
        {(worstCorridor || bestProvider) && (
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {worstCorridor && (
              <div style={{ flex: 1, background: "#0a0a14", border: `1px solid ${BORDER}`, borderRadius: "10px", padding: "16px 20px" }}>
                <div style={{ color: "#555", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>Highest Volume Corridor</div>
                <div style={{ color: "#fff", fontSize: "16px", fontWeight: 600 }}>{worstCorridor.corridor}</div>
                <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                  {fmt(worstCorridor.tx_count)} transactions · avg spread {worstCorridor.avg_spread}% · markup cost {fmt(worstCorridor.markup_cost)}
                </div>
              </div>
            )}
            {bestProvider && (
              <div style={{ flex: 1, background: "#0a0a14", border: `1px solid ${BORDER}`, borderRadius: "10px", padding: "16px 20px" }}>
                <div style={{ color: "#555", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>Best Performing Provider</div>
                <div style={{ color: TEAL, fontSize: "16px", fontWeight: 600 }}>{bestProvider.provider}</div>
                <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                  Lowest avg spread at {bestProvider.avg_spread}% · {fmt(bestProvider.tx_count)} transactions
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Main chat UI ──────────────────────────────────────────────
function ChatUI({ companyName, onResetConfig }) {
  const tenantId = getTenantId();
  const [view, setView]                   = useState("chat"); // "chat" | "dashboard"
  const [sessionId, setSessionId]         = useState(() => newSessionId());
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages]           = useState([WELCOME_MSG(companyName)]);
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [hoveredId, setHoveredId]         = useState(null);
  const bottomRef = useRef(null);

  const SUGGESTED = [
    "NGN market overview for GBP",
    "Show all our diaspora remittance corridors",
    "Which corridors had the worst FX markup this quarter?",
    "Deep dive into our highest volume corridor",
    "Should we send large payments now or wait?",
  ];

  useEffect(() => { fetchConversations(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/conversations`);
      if (res.ok) setConversations(await res.json());
    } catch (_) {}
  }, []);

  const startNewChat = () => {
    setSessionId(newSessionId());
    setMessages([WELCOME_MSG(companyName)]);
    setInput("");
    setError(null);
  };

  const loadConversation = async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/conversations/${sid}`);
      if (res.ok) {
        const msgs = await res.json();
        setMessages(msgs.length > 0 ? msgs.map((m) => ({ role: m.role, content: m.content })) : [WELCOME_MSG(companyName)]);
        setSessionId(sid);
        setError(null);
      }
    } catch (_) {}
  };

  const deleteConversation = async (e, sid) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/conversations/${sid}`, { method: "DELETE" });
      if (sid === sessionId) startNewChat();
      fetchConversations();
    } catch (_) {}
  };

  const sendMessage = async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, session_id: sessionId, tenant_id: tenantId }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "Server error"); }
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
      fetchConversations();
    } catch (err) {
      const isNetwork = err.message.toLowerCase().includes("fetch");
      setError(isNetwork ? "disconnected" : err.message);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `⚠️ ${isNetwork ? "Server not reachable. Run: uvicorn server:app --reload --port 8000" : err.message}`,
      }]);
    } finally { setLoading(false); }
  };

  const formatDate = (iso) => {
    const d = new Date(iso), today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#08080f", display: "flex", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d0d1a; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
        textarea { resize: none; } textarea:focus { outline: none; }
        .conv-item:hover { background: #111120 !important; }
        .del-btn:hover { color: #ff5555 !important; }
      `}</style>

      {/* Sidebar */}
      <div style={{ width: "260px", background: "#0a0a14", borderRight: "1px solid #1a1a2a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #1a1a2a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <div style={{ width: "32px", height: "32px", background: "linear-gradient(135deg, #00d4aa, #00a884)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>💱</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: "13px" }}>{companyName || "FXAgent"}</div>
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace" }}>FXAgent workspace</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            {["chat", "dashboard"].map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                flex: 1, padding: "7px 0", borderRadius: "7px", fontSize: "12px", cursor: "pointer",
                background: view === v ? "#00d4aa18" : "#0f0f1e",
                border: `1px solid ${view === v ? "#00d4aa55" : "#252535"}`,
                color: view === v ? "#00d4aa" : "#666", fontWeight: view === v ? 600 : 400,
                transition: "all 0.15s",
              }}>{v === "chat" ? "💬 Chat" : "📊 Dashboard"}</button>
            ))}
          </div>
          <button onClick={startNewChat} style={{ width: "100%", padding: "8px 12px", background: "#0f0f1e", border: "1px solid #252535", borderRadius: "8px", color: "#aaa", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", transition: "all 0.15s" }}>
            <span style={{ fontSize: "16px" }}>+</span> New Chat
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {conversations.length === 0 ? (
            <div style={{ color: "#333", fontSize: "12px", textAlign: "center", padding: "24px 8px" }}>No conversations yet</div>
          ) : conversations.map((c) => {
            const isActive = c.session_id === sessionId;
            return (
              <div key={c.session_id} className="conv-item" onClick={() => loadConversation(c.session_id)}
                onMouseEnter={() => setHoveredId(c.session_id)} onMouseLeave={() => setHoveredId(null)}
                style={{ padding: "8px 10px", borderRadius: "8px", cursor: "pointer", background: isActive ? "#141420" : "transparent", border: isActive ? "1px solid #252535" : "1px solid transparent", marginBottom: "2px", display: "flex", alignItems: "center", gap: "8px", transition: "background 0.15s" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isActive ? "#e0e0f0" : "#888", fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</div>
                  <div style={{ color: "#444", fontSize: "10px", marginTop: "2px" }}>{formatDate(c.updated_at)}</div>
                </div>
                {(isActive || hoveredId === c.session_id) && (
                  <button className="del-btn" onClick={(e) => deleteConversation(e, c.session_id)}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "16px", padding: "2px 4px", borderRadius: "4px", flexShrink: 0, transition: "color 0.15s" }}>×</button>
                )}
              </div>
            );
          })}
        </div>

        {/* Settings link at bottom */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a2a" }}>
          <button onClick={onResetConfig} style={{ background: "none", border: "none", color: "#444", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
            ⚙ Update workspace settings
          </button>
        </div>
      </div>

      {/* Dashboard view */}
      {view === "dashboard" && <Dashboard companyName={companyName} />}

      {/* Main chat */}
      {view === "chat" && <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #1a1a2a", display: "flex", alignItems: "center", gap: "12px", background: "#0a0a14" }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>FXAgent</div>
            <div style={{ color: "#00d4aa", fontSize: "11px", fontFamily: "monospace" }}>Nigerian Fintech · Cross-Border & Diaspora Remittance</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: error ? "#ff5555" : "#00d4aa", boxShadow: `0 0 6px ${error ? "#ff5555" : "#00d4aa"}` }} />
            <span style={{ color: "#555", fontSize: "12px" }}>{error ? "disconnected" : "live"}</span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 0" }}>
          <div style={{ maxWidth: "720px", margin: "0 auto" }}>
            {messages.map((msg, i) => <Message key={i} msg={msg} />)}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} style={{ height: "20px" }} />
          </div>
        </div>

        {messages.length <= 1 && !loading && (
          <div style={{ padding: "0 20px 12px" }}>
            <div style={{ maxWidth: "720px", margin: "0 auto", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {SUGGESTED.map((s, i) => (
                <button key={i} onClick={() => sendMessage(s)} style={{ background: "#0f0f1e", border: "1px solid #252535", color: "#aaa", padding: "6px 12px", borderRadius: "20px", fontSize: "12px", cursor: "pointer", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.target.style.borderColor = "#00d4aa66"; e.target.style.color = "#00d4aa"; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = "#252535"; e.target.style.color = "#aaa"; }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: "12px 20px 20px", borderTop: "1px solid #1a1a2a", background: "#0a0a14" }}>
          <div style={{ maxWidth: "720px", margin: "0 auto", display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <div style={{ flex: 1, background: "#0f0f1e", border: "1px solid #252535", borderRadius: "14px", padding: "10px 14px" }}>
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Ask about rates, corridors, providers..." rows={1}
                style={{ width: "100%", background: "transparent", border: "none", color: "#e0e0f0", fontSize: "14px", lineHeight: 1.5, fontFamily: "inherit", maxHeight: "100px", overflowY: "auto" }} />
            </div>
            <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
              style={{ width: "42px", height: "42px", borderRadius: "12px", background: loading || !input.trim() ? "#1a1a2e" : "linear-gradient(135deg, #00d4aa, #00a884)", border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", transition: "all 0.2s", flexShrink: 0, color: "#fff" }}>→</button>
          </div>
        </div>
      </div>}
    </div>
  );
}


// ── Root app — manages onboarding state ───────────────────────
export default function App() {
  const [ready, setReady]             = useState(false);
  const [configured, setConfigured]   = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [serverUp, setServerUp]       = useState(null); // null=unknown, true/false

  const checkServer = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/health`);
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
        .then((config) => { setCompanyName(config.company_name); setConfigured(true); })
        .catch(() => setConfigured(false))
        .finally(() => setReady(true));
    });
  }, [checkServer]);

  if (!ready) return (
    <div style={{ minHeight: "100vh", background: "#08080f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#00d4aa", fontFamily: "monospace", fontSize: "14px" }}>Loading...</div>
    </div>
  );

  if (!configured) return (
    <OnboardingScreen
      serverUp={serverUp}
      onRetryConnection={async () => { const up = await checkServer(); if (up) window.location.reload(); }}
      onComplete={(name) => { setCompanyName(name); setConfigured(true); }}
    />
  );

  return (
    <ChatUI
      companyName={companyName}
      onResetConfig={() => { setConfigured(false); setCompanyName(""); }}
    />
  );
}
