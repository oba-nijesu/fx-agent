from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

from agent import (
    get_session_executor,
    init_db,
    seed_demo_data,
    upsert_conversation,
    save_message_to_db,
    list_conversations_db,
    get_conversation_messages_db,
    delete_conversation_db,
    save_tenant_config,
    get_tenant_config_db,
    _session_executors,
)

init_db()
seed_demo_data()

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
    {"value": "GBP>NGN", "label": "GBP → NGN", "desc": "UK · Nigeria"},
    {"value": "USD>NGN", "label": "USD → NGN", "desc": "US · Nigeria"},
    {"value": "EUR>NGN", "label": "EUR → NGN", "desc": "EU · Nigeria"},
    {"value": "CAD>NGN", "label": "CAD → NGN", "desc": "Canada · Nigeria"},
    {"value": "USD>GHS", "label": "USD → GHS", "desc": "US · Ghana"},
    {"value": "GBP>GHS", "label": "GBP → GHS", "desc": "UK · Ghana"},
    {"value": "USD>KES", "label": "USD → KES", "desc": "US · Kenya"},
    {"value": "GBP>KES", "label": "GBP → KES", "desc": "UK · Kenya"},
    {"value": "USD>XOF", "label": "USD → XOF", "desc": "US · Francophone W. Africa"},
    {"value": "USD>ZAR", "label": "USD → ZAR", "desc": "US · South Africa"},
    {"value": "GBP>EUR", "label": "GBP → EUR", "desc": "UK · Europe"},
    {"value": "USD>EUR", "label": "USD → EUR", "desc": "US · Europe"},
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
    )
    return {"status": "saved", "tenant_id": req.tenant_id}
