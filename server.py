import csv
import io
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from apscheduler.schedulers.background import BackgroundScheduler

from agent import (
    get_session_executor,
    init_db,
    seed_demo_data,
    settle_transaction,
    upsert_conversation,
    save_message_to_db,
    list_conversations_db,
    get_conversation_messages_db,
    delete_conversation_db,
    save_tenant_config,
    get_tenant_config_db,
    get_dashboard_data,
    check_spread_alerts,
    log_transaction,
    get_db,
    _session_executors,
)

init_db()
seed_demo_data()

# ── Background scheduler ──────────────────────────────────────
scheduler = BackgroundScheduler()
scheduler.add_job(check_spread_alerts, "interval", hours=1, id="spread_alerts")
scheduler.start()

app = FastAPI(
    title="FXAgent API",
    description="FX intelligence for Nigerian fintech — cross-border & diaspora remittance",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Static options ────────────────────────────────────────────

CORRIDOR_OPTIONS = [
    # Diaspora remittance into Nigeria
    {"value": "GBP>NGN", "label": "GBP → NGN", "desc": "UK · Nigeria"},
    {"value": "USD>NGN", "label": "USD → NGN", "desc": "US · Nigeria"},
    {"value": "EUR>NGN", "label": "EUR → NGN", "desc": "EU · Nigeria"},
    {"value": "CAD>NGN", "label": "CAD → NGN", "desc": "Canada · Nigeria"},
    {"value": "AED>NGN", "label": "AED → NGN", "desc": "UAE · Nigeria"},
    {"value": "AUD>NGN", "label": "AUD → NGN", "desc": "Australia · Nigeria"},
    {"value": "CHF>NGN", "label": "CHF → NGN", "desc": "Switzerland · Nigeria"},
    # West Africa
    {"value": "USD>GHS", "label": "USD → GHS", "desc": "US · Ghana"},
    {"value": "GBP>GHS", "label": "GBP → GHS", "desc": "UK · Ghana"},
    {"value": "EUR>GHS", "label": "EUR → GHS", "desc": "EU · Ghana"},
    {"value": "USD>XOF", "label": "USD → XOF", "desc": "US · Francophone W. Africa"},
    {"value": "EUR>XOF", "label": "EUR → XOF", "desc": "EU · Francophone W. Africa"},
    # East Africa
    {"value": "USD>KES", "label": "USD → KES", "desc": "US · Kenya"},
    {"value": "GBP>KES", "label": "GBP → KES", "desc": "UK · Kenya"},
    {"value": "USD>TZS", "label": "USD → TZS", "desc": "US · Tanzania"},
    {"value": "USD>UGX", "label": "USD → UGX", "desc": "US · Uganda"},
    # Southern Africa
    {"value": "USD>ZAR", "label": "USD → ZAR", "desc": "US · South Africa"},
    {"value": "GBP>ZAR", "label": "GBP → ZAR", "desc": "UK · South Africa"},
]

PROVIDER_OPTIONS = [
    "Stanbic IBTC", "Access Bank", "Fidelity Bank", "Ecobank",
    "Verto FX", "Flutterwave", "Nium", "Wise", "Airwallex", "SWIFT",
]


# ── Models ────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    tenant_id: str = "default"

class ChatResponse(BaseModel):
    answer: str
    session_id: str

class TenantConfigRequest(BaseModel):
    tenant_id: str
    company_name: str
    corridors: List[str]
    providers: List[str]
    spread_threshold: float = 3.0
    alert_email: str = ""

class TransactionRequest(BaseModel):
    corridor: str
    amount_base: float
    applied_rate: float
    mid_market_rate: float
    provider: str = "manual"
    notes: str = ""
    fee_usd: float = 0.0
    initiated_at: Optional[str] = None

class SettleRequest(BaseModel):
    transaction_id: int
    settled_at: str
    settlement_rate: float


# ── Core routes ───────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "FXAgent API is running 💱"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    try:
        upsert_conversation(request.session_id, first_message=request.message)
        save_message_to_db(request.session_id, "user", request.message)

        result = get_session_executor(
            request.session_id, request.tenant_id
        ).invoke({"input": request.message})
        answer = result["output"]

        save_message_to_db(request.session_id, "assistant", answer)
        return ChatResponse(answer=answer, session_id=request.session_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")


# ── Conversation history routes ───────────────────────────────

@app.get("/conversations")
def list_conversations():
    return list_conversations_db()


@app.get("/conversations/{session_id}")
def get_conversation(session_id: str):
    return get_conversation_messages_db(session_id)


@app.delete("/conversations/{session_id}")
def delete_conversation(session_id: str):
    delete_conversation_db(session_id)
    keys = [k for k in _session_executors if k.endswith(f":{session_id}")]
    for k in keys:
        _session_executors.pop(k, None)
    return {"status": "deleted"}


# ── Tenant config routes ──────────────────────────────────────

@app.get("/config/options")
def config_options():
    """Return the available corridors and providers for the onboarding form."""
    return {"corridors": CORRIDOR_OPTIONS, "providers": PROVIDER_OPTIONS}


@app.get("/config/{tenant_id}")
def get_config(tenant_id: str):
    config = get_tenant_config_db(tenant_id)
    if not config:
        raise HTTPException(status_code=404, detail="No config found for this tenant.")
    return config


@app.post("/config")
def save_config(req: TenantConfigRequest):
    save_tenant_config(
        tenant_id=req.tenant_id,
        company_name=req.company_name,
        corridors=req.corridors,
        providers=req.providers,
        spread_threshold=req.spread_threshold,
        alert_email=req.alert_email,
    )
    return {"status": "saved", "tenant_id": req.tenant_id}


# ── Dashboard route ───────────────────────────────────────────

@app.get("/dashboard/{tenant_id}")
def get_dashboard(tenant_id: str):
    config = get_tenant_config_db(tenant_id)
    corridors = config.get("corridors") if config else None
    return get_dashboard_data(corridors=corridors)


# ── Transaction ingestion ─────────────────────────────────────

@app.post("/transactions")
def ingest_transaction(req: TransactionRequest):
    try:
        parts = req.corridor.upper().split(">")
        if len(parts) != 2:
            raise HTTPException(status_code=400, detail="corridor must be BASE>TARGET e.g. GBP>NGN")
        base, target = parts
        amount_target = round(req.amount_base * req.applied_rate, 4)
        log_transaction(
            base=base, target=target,
            amount_base=req.amount_base, amount_target=amount_target,
            mid_market_rate=req.mid_market_rate, applied_rate=req.applied_rate,
            provider=req.provider, notes=req.notes, fee_usd=req.fee_usd,
            initiated_at=req.initiated_at,
        )
        spread_pct = round(abs((req.applied_rate - req.mid_market_rate) / req.mid_market_rate) * 100, 4)
        return {"status": "logged", "corridor": req.corridor, "spread_pct": spread_pct}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Settlement endpoint ───────────────────────────────────────

@app.post("/transactions/settle")
def settle(req: SettleRequest):
    """Mark a transaction as settled with the final rate and settlement time."""
    try:
        settle_transaction(req.transaction_id, req.settled_at, req.settlement_rate)
        return {"status": "settled", "transaction_id": req.transaction_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── CSV export ────────────────────────────────────────────────

@app.get("/export/csv/{tenant_id}")
def export_csv(tenant_id: str, days: int = Query(default=90, ge=1, le=365)):
    """
    Download a reconciliation CSV for a tenant's transactions.
    Formatted for direct import into QuickBooks, Xero, or custom ledgers.
    """
    config = get_tenant_config_db(tenant_id)
    corridors = config.get("corridors") if config else None

    if corridors:
        ph = ",".join("?" * len(corridors))
        where = f"WHERE corridor IN ({ph}) AND timestamp >= DATE('now', '-{days} days')"
        args = corridors
    else:
        where = f"WHERE timestamp >= DATE('now', '-{days} days')"
        args = []

    sql = f"""
        SELECT
            id,
            DATE(timestamp)         AS date,
            corridor,
            provider,
            amount_base,
            base_currency,
            amount_target,
            target_currency,
            mid_market_rate,
            applied_rate,
            spread_pct,
            ROUND(amount_base * spread_pct / 100, 4) AS markup_cost,
            fee_usd,
            notes,
            initiated_at,
            settled_at,
            settlement_rate
        FROM transactions
        {where}
        ORDER BY timestamp DESC
    """

    try:
        with get_db() as conn:
            rows = conn.execute(sql, args).fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "Date", "Corridor", "Provider",
            "Amount (Base)", "Base Currency", "Amount (Target)", "Target Currency",
            "Mid-Market Rate", "Applied Rate", "Spread %", "Markup Cost (Base)",
            "Fee (USD)", "Notes", "Initiated At", "Settled At", "Settlement Rate",
        ])
        for r in rows:
            writer.writerow([
                r["id"], r["date"], r["corridor"], r["provider"],
                r["amount_base"], r["base_currency"], r["amount_target"], r["target_currency"],
                r["mid_market_rate"], r["applied_rate"], r["spread_pct"], r["markup_cost"],
                r["fee_usd"], r["notes"], r["initiated_at"] or "", r["settled_at"] or "",
                r["settlement_rate"] or "",
            ])

        output.seek(0)
        filename = f"fxagent-reconciliation-{days}d.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
