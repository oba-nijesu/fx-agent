# ============================================================
#  FX Currency Intelligence Agent — Stage 3
#  New in Stage 3:
#    ✅ SQLite corridor database (no Postgres setup needed)
#    ✅ Auto-logs every conversion with rate, spread, markup
#    ✅ Corridor performance analysis (best/worst spreads)
#    ✅ Volume & markup aggregations per corridor
#    ✅ CFO-style natural language queries on transaction history
#    ✅ Seed data generator so you can query immediately
# ============================================================

import os
import json
import sqlite3
import random
import requests
from datetime import datetime, timedelta
from contextlib import contextmanager
import dateparser
from dotenv import load_dotenv

load_dotenv()

from langchain.agents import AgentExecutor, create_react_agent
from langchain.tools import tool
from langchain_core.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferWindowMemory


# ════════════════════════════════════════════════════════════
#  API KEYS
# ════════════════════════════════════════════════════════════
OPENAI_API_KEY       = os.getenv("OPENAI_API_KEY")
EXCHANGERATE_API_KEY = os.getenv("EXCHANGERATE_API_KEY")


# ════════════════════════════════════════════════════════════
#  DATABASE SETUP
#  Uses SQLite — no installation needed, file lives locally
#  To upgrade to Postgres later, just swap the connection string
# ════════════════════════════════════════════════════════════

DB_PATH = "fx_corridor.db"


@contextmanager
def get_db():
    """Context manager for safe DB connections."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # allows dict-like access
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Create all database tables if they don't exist."""
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp       TEXT NOT NULL,
                base_currency   TEXT NOT NULL,
                target_currency TEXT NOT NULL,
                corridor        TEXT NOT NULL,
                amount_base     REAL NOT NULL,
                amount_target   REAL NOT NULL,
                mid_market_rate REAL NOT NULL,
                applied_rate    REAL NOT NULL,
                spread_pct      REAL NOT NULL,
                fee_usd         REAL DEFAULT 0.0,
                provider        TEXT DEFAULT 'manual',
                notes           TEXT DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                session_id  TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT 'New Chat',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                timestamp   TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenant_config (
                tenant_id          TEXT PRIMARY KEY,
                company_name       TEXT NOT NULL,
                corridors          TEXT NOT NULL DEFAULT '[]',
                providers          TEXT NOT NULL DEFAULT '[]',
                spread_threshold   REAL NOT NULL DEFAULT 3.0,
                created_at         TEXT NOT NULL,
                updated_at         TEXT NOT NULL
            )
        """)


def log_transaction(
    base: str,
    target: str,
    amount_base: float,
    amount_target: float,
    mid_market_rate: float,
    applied_rate: float,
    provider: str = "manual",
    notes: str = "",
    fee_usd: float = 0.0,
):
    """Save a conversion to the database."""
    spread_pct = ((mid_market_rate - applied_rate) / mid_market_rate) * 100
    corridor = f"{base}>{target}"
    with get_db() as conn:
        conn.execute("""
            INSERT INTO transactions
              (timestamp, base_currency, target_currency, corridor,
               amount_base, amount_target, mid_market_rate, applied_rate,
               spread_pct, fee_usd, provider, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            datetime.utcnow().isoformat(),
            base.upper(), target.upper(), corridor,
            amount_base, amount_target,
            mid_market_rate, applied_rate,
            spread_pct, fee_usd, provider, notes
        ))


def seed_demo_data():
    """
    Populate the DB with 90 days of realistic demo transactions.
    Runs only if the table is empty — safe to call on every startup.
    """
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    if count > 0:
        return  # already seeded

    print("🌱 Seeding demo corridor data (90 days)...")

    corridors = [
        # Diaspora remittance — primary revenue corridors for Nigerian fintechs
        ("GBP", "NGN", 1990, 0.028),    # UK → Nigeria (highest txn count, UK diaspora)
        ("USD", "NGN", 1570, 0.025),    # US → Nigeria (largest USD volume)
        ("EUR", "NGN", 1720, 0.027),    # EU → Nigeria
        ("CAD", "NGN", 1150, 0.030),    # Canada → Nigeria (fast-growing corridor)
        # Pan-African corridors
        ("USD", "GHS", 15.5, 0.020),    # US → Ghana
        ("GBP", "GHS", 19.6, 0.022),    # UK → Ghana
        ("USD", "KES", 129,  0.018),    # US → Kenya (East Africa gateway)
        ("GBP", "KES", 163,  0.021),    # UK → Kenya
        ("USD", "XOF", 620,  0.022),    # US → Francophone West Africa (8 UEMOA countries)
        ("USD", "ZAR", 18.5, 0.015),    # US → South Africa
    ]

    providers = ["Stanbic IBTC", "Access Bank", "Fidelity Bank", "Ecobank", "Verto FX", "Flutterwave", "Nium"]
    base_date = datetime.utcnow() - timedelta(days=90)

    entries = []
    for day_offset in range(90):
        tx_date = base_date + timedelta(days=day_offset)
        # 2-5 transactions per day
        for _ in range(random.randint(2, 5)):
            base, target, base_rate, avg_spread = random.choice(corridors)
            # simulate rate drift ±3% over time
            drift = 1 + random.uniform(-0.03, 0.03)
            mid_rate = round(base_rate * drift, 6)
            # spread varies ±50% around avg
            spread = avg_spread * random.uniform(0.5, 1.5)
            applied_rate = round(mid_rate * (1 - spread), 6)
            amount = round(random.uniform(1000, 100000), 2)
            received = round(amount * applied_rate, 2)
            fee = round(random.uniform(5, 50), 2)
            spread_pct = round(spread * 100, 4)
            corridor = f"{base}>{target}"
            provider = random.choice(providers)
            entries.append((
                tx_date.isoformat(), base, target, corridor,
                amount, received, mid_rate, applied_rate,
                spread_pct, fee, provider, "demo"
            ))

    with get_db() as conn:
        conn.executemany("""
            INSERT INTO transactions
              (timestamp, base_currency, target_currency, corridor,
               amount_base, amount_target, mid_market_rate, applied_rate,
               spread_pct, fee_usd, provider, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, entries)

    print(f"✅ Seeded {len(entries)} demo transactions across {len(corridors)} corridors.\n")


# ════════════════════════════════════════════════════════════
#  CONVERSATION PERSISTENCE
# ════════════════════════════════════════════════════════════

def upsert_conversation(session_id: str, first_message: str = ""):
    """Create or touch a conversation record. Title is set from the first user message."""
    now = datetime.utcnow().isoformat()
    title = (first_message[:47] + "...") if len(first_message) > 50 else first_message or "New Chat"
    with get_db() as conn:
        existing = conn.execute(
            "SELECT session_id FROM conversations WHERE session_id = ?", (session_id,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE session_id = ?",
                (now, session_id)
            )
        else:
            conn.execute(
                "INSERT INTO conversations (session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (session_id, title, now, now)
            )


def save_message_to_db(session_id: str, role: str, content: str):
    """Persist a single chat message."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            (session_id, role, content, datetime.utcnow().isoformat())
        )


def list_conversations_db():
    """Return all conversations ordered by most recently updated."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT session_id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50"
        ).fetchall()
    return [dict(r) for r in rows]


def get_conversation_messages_db(session_id: str):
    """Return all messages for a session in chronological order."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def delete_conversation_db(session_id: str):
    """Delete a conversation and all its messages."""
    with get_db() as conn:
        conn.execute("DELETE FROM conversations WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))


# ════════════════════════════════════════════════════════════
#  TENANT CONFIGURATION
# ════════════════════════════════════════════════════════════

def save_tenant_config(
    tenant_id: str,
    company_name: str,
    corridors: list,
    providers: list,
    spread_threshold: float = 3.0,
):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute("""
            INSERT INTO tenant_config
              (tenant_id, company_name, corridors, providers, spread_threshold, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id) DO UPDATE SET
              company_name     = excluded.company_name,
              corridors        = excluded.corridors,
              providers        = excluded.providers,
              spread_threshold = excluded.spread_threshold,
              updated_at       = excluded.updated_at
        """, (
            tenant_id, company_name,
            json.dumps(corridors), json.dumps(providers),
            spread_threshold, now, now,
        ))
    # Invalidate cached agent for this tenant so it rebuilds with new config
    _tenant_agents.pop(tenant_id, None)
    keys_to_drop = [k for k in _session_executors if k.startswith(f"{tenant_id}:")]
    for k in keys_to_drop:
        _session_executors.pop(k, None)


def get_tenant_config_db(tenant_id: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM tenant_config WHERE tenant_id = ?", (tenant_id,)
        ).fetchone()
    if not row:
        return None
    config = dict(row)
    config["corridors"] = json.loads(config["corridors"])
    config["providers"]  = json.loads(config["providers"])
    return config


# ════════════════════════════════════════════════════════════
#  HELPERS
# ════════════════════════════════════════════════════════════

def clean_input(query: str) -> str:
    return query.strip().replace('"', '').replace("'", "")


def get_rate_raw(base: str, target: str):
    url = f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/pair/{base}/{target}"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        if data.get("result") == "success":
            return float(data["conversion_rate"])
    except Exception:
        pass
    return None


def get_historical_rate_raw(base: str, target: str, date: datetime):
    """
    Returns a raw float historical rate using a 3-source fallback chain:
    1. ExchangeRate API (paid plan required for NGN)
    2. Frankfurter API (free, major currencies only)
    3. Internal corridor DB (uses closest recorded rate within ±3 days)
    """
    # Source 1 — ExchangeRate API
    url = (
        f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/history"
        f"/{base}/{date.strftime('%Y')}/{date.strftime('%m')}/{date.strftime('%d')}"
    )
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        if data.get("result") == "success":
            rate = data["conversion_rates"].get(target)
            if rate:
                return float(rate)
    except Exception:
        pass

    # Source 2 — Frankfurter (free, major currencies only)
    try:
        date_str = date.strftime("%Y-%m-%d")
        r = requests.get(
            f"https://api.frankfurter.app/{date_str}?from={base}&to={target}",
            timeout=10
        )
        if r.status_code == 200:
            rate = r.json().get("rates", {}).get(target)
            if rate:
                return float(rate)
    except Exception:
        pass

    # Source 3 — Internal corridor DB fallback
    corridor = f"{base}>{target}"
    date_str = date.strftime("%Y-%m-%d")
    try:
        with get_db() as conn:
            row = conn.execute("""
                SELECT applied_rate
                FROM transactions
                WHERE corridor = ?
                  AND DATE(timestamp) BETWEEN DATE(?, '-3 days')
                  AND DATE(?, '+3 days')
                ORDER BY ABS(JULIANDAY(timestamp) - JULIANDAY(?))
                LIMIT 1
            """, (corridor, date_str, date_str, date_str)).fetchone()
            if row:
                return float(row["applied_rate"])
    except Exception:
        pass

    return None


def sentiment(change_pct: float, base: str, target: str) -> str:
    if change_pct > 1.5:
        return f"📈 Strong gain — {base} is strengthening against {target}"
    elif change_pct > 0.3:
        return f"📈 Slight gain — {base} is marginally stronger"
    elif change_pct < -1.5:
        return f"📉 Notable decline — {base} is weakening against {target}"
    elif change_pct < -0.3:
        return f"📉 Slight dip — {base} softened a little"
    else:
        return f"➡️  Stable — rate has barely moved"


# ════════════════════════════════════════════════════════════
#  EXISTING TOOLS (unchanged from Stage 2)
# ════════════════════════════════════════════════════════════

@tool
def get_exchange_rate(query: str) -> str:
    """
    Get the latest live exchange rate between two currencies.
    Input format: "BASE TARGET"
    Examples: "USD NGN", "EUR GBP", "USD RWF"
    """
    if not EXCHANGERATE_API_KEY:
        return "Error: EXCHANGERATE_API_KEY is not set."
    try:
        parts = clean_input(query).split()
        if len(parts) != 2:
            return "Invalid format. Use: 'BASE TARGET' e.g. 'USD NGN'"
        base, target = parts[0].upper(), parts[1].upper()
    except Exception:
        return "Could not parse input."

    url = f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/pair/{base}/{target}"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("result") == "success":
            rate = data["conversion_rate"]
            updated = data.get("time_last_update_utc", "recently")

            # ── Auto-log this rate lookup as a reference transaction ──
            # We don't log lookups — only actual conversions (see convert_currency)

            return f"1 {base} = {rate} {target}\nRate last updated: {updated}"
        return f"API Error: {data.get('error-type', 'Unknown error')}"
    except Exception as e:
        return f"Error fetching rate: {str(e)}"


@tool
def convert_currency(query: str) -> str:
    """
    Convert a specific amount from one currency to another using live rates.
    Automatically logs the transaction to the corridor database.
    Input format: "AMOUNT BASE TARGET"
    Examples: "500 USD NGN", "1000 EUR GBP", "250.50 USD JPY"
    """
    if not EXCHANGERATE_API_KEY:
        return "Error: EXCHANGERATE_API_KEY is not set."
    try:
        parts = clean_input(query).split()
        if len(parts) != 3:
            return "Invalid format. Use: 'AMOUNT BASE TARGET' e.g. '500 USD NGN'"
        amount, base, target = float(parts[0]), parts[1].upper(), parts[2].upper()
    except ValueError:
        return "Could not parse input. Format: 'AMOUNT BASE TARGET'"

    url = f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/pair/{base}/{target}/{amount}"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("result") == "success":
            converted = data["conversion_result"]
            applied_rate = data["conversion_rate"]

            # ── Auto-log to corridor DB ──────────────────────────────
            mid_rate = get_rate_raw(base, target) or applied_rate
            log_transaction(
                base=base, target=target,
                amount_base=amount, amount_target=converted,
                mid_market_rate=mid_rate, applied_rate=applied_rate,
                provider="ExchangeRate-API", notes="via agent"
            )

            return (
                f"{amount:,.2f} {base} = {converted:,.2f} {target}\n"
                f"Rate applied: 1 {base} = {applied_rate} {target}\n"
                f"✅ Transaction logged to corridor database."
            )
        return f"Conversion failed: {data.get('error-type')}"
    except Exception as e:
        return f"Error during conversion: {str(e)}"


@tool
def get_historical_rate(query: str) -> str:
    """
    Get the exchange rate for a specific historical date or natural language expression.
    Input format: "BASE TARGET DATE"
    Examples: "USD NGN 2024-11-01", "EUR GBP 3 days ago"
    """
    if not EXCHANGERATE_API_KEY:
        return "Error: EXCHANGERATE_API_KEY is not set."
    try:
        parts = clean_input(query).split()
        if len(parts) < 3:
            return "Invalid format. Use: 'BASE TARGET DATE'"
        base, target = parts[0].upper(), parts[1].upper()
        date_string = " ".join(parts[2:])
    except Exception:
        return "Could not parse input."

    parsed_date = dateparser.parse(date_string)
    if not parsed_date:
        return f"Could not interpret '{date_string}'."

    formatted = parsed_date.strftime("%B %d, %Y")

    # Try Frankfurter first (free, major currencies)
    try:
        date_str = parsed_date.strftime("%Y-%m-%d")
        r = requests.get(f"https://api.frankfurter.app/{date_str}?from={base}&to={target}", timeout=10)
        if r.status_code == 200:
            data = r.json()
            rate = data.get("rates", {}).get(target)
            if rate:
                return f"Rate on {formatted}: 1 {base} = {rate} {target} (via Frankfurter)"
    except Exception:
        pass

    # Fallback to ExchangeRate API
    url = (
        f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/history"
        f"/{base}/{parsed_date.strftime('%Y')}/{parsed_date.strftime('%m')}/{parsed_date.strftime('%d')}"
    )
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("result") == "success":
            rate = data["conversion_rates"].get(target)
            if rate:
                return f"Rate on {formatted}: 1 {base} = {rate} {target}"
        return f"Historical data unavailable for {base}/{target} on {formatted}. A paid ExchangeRate API plan is required for NGN historical data."
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def analyze_trend(query: str) -> str:
    """
    Analyze the trend of a currency pair over the last 7 and 30 days.
    Input format: "BASE TARGET"
    Examples: "USD NGN", "EUR GBP"
    """
    if not EXCHANGERATE_API_KEY:
        return "Error: EXCHANGERATE_API_KEY is not set."
    try:
        parts = clean_input(query).split()
        if len(parts) != 2:
            return "Invalid format. Use: 'BASE TARGET'"
        base, target = parts[0].upper(), parts[1].upper()
    except Exception:
        return "Could not parse input."

    today = datetime.today()
    current_rate = get_rate_raw(base, target)
    rate_7d = get_historical_rate_raw(base, target, today - timedelta(days=7))
    rate_30d = get_historical_rate_raw(base, target, today - timedelta(days=30))

    if not current_rate:
        return f"Could not fetch current rate for {base}/{target}."

    lines = [
        f"📊 Trend Analysis: {base} → {target}",
        f"{'─' * 42}",
        f"Current rate :  1 {base} = {current_rate:.4f} {target}",
    ]
    # Check which source the historical rates came from
    def source_label(rate, base, target, days):
        if not rate:
            return None, "Not available (no API access or DB records for this corridor)"
        # Try to determine source by re-checking APIs
        corridor = f"{base}>{target}"
        date = datetime.today() - timedelta(days=days)
        date_str = date.strftime("%Y-%m-%d")
        try:
            with get_db() as conn:
                row = conn.execute("""
                    SELECT applied_rate FROM transactions
                    WHERE corridor = ?
                      AND DATE(timestamp) BETWEEN DATE(?, '-3 days')
                      AND DATE(?, '+3 days')
                    LIMIT 1
                """, (corridor, date_str, date_str)).fetchone()
                if row and abs(float(row["applied_rate"]) - rate) < 0.01:
                    return rate, "(from internal DB records)"
        except Exception:
            pass
        return rate, "(from API)"

    if rate_7d:
        chg7 = ((current_rate - rate_7d) / rate_7d) * 100
        arrow = "▲" if chg7 >= 0 else "▼"
        _, src7 = source_label(rate_7d, base, target, 7)
        lines.append(f"7 days ago   :  1 {base} = {rate_7d:.4f} {target}  {arrow} {abs(chg7):.2f}%  {src7}")
        lines.append(f"7-day signal :  {sentiment(chg7, base, target)}")
    else:
        lines.append("7-day data   :  Not available (no API access or DB records for this corridor)")
    if rate_30d:
        chg30 = ((current_rate - rate_30d) / rate_30d) * 100
        arrow = "▲" if chg30 >= 0 else "▼"
        _, src30 = source_label(rate_30d, base, target, 30)
        lines.append(f"30 days ago  :  1 {base} = {rate_30d:.4f} {target}  {arrow} {abs(chg30):.2f}%  {src30}")
        lines.append(f"30-day signal:  {sentiment(chg30, base, target)}")
    else:
        lines.append("30-day data  :  Not available (no API access or DB records for this corridor)")
    return "\n".join(lines)


@tool
def multi_currency_snapshot(query: str) -> str:
    """
    Get a snapshot of one base currency vs multiple targets simultaneously.
    Input format: "BASE TARGET1 TARGET2 TARGET3 ..."
    Examples: "USD NGN EUR GBP JPY"
    """
    if not EXCHANGERATE_API_KEY:
        return "Error: EXCHANGERATE_API_KEY is not set."
    try:
        parts = clean_input(query).upper().split()
        if len(parts) < 2:
            return "Invalid format. Use: 'BASE TARGET1 TARGET2 ...'"
        base, targets = parts[0], parts[1:]
    except Exception:
        return "Could not parse input."

    url = f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/latest/{base}"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("result") != "success":
            return f"Failed to fetch rates: {data.get('error-type')}"
        rates = data["conversion_rates"]
        updated = data.get("time_last_update_utc", "recently")
        lines = [f"💱 {base} Snapshot", f"Updated: {updated}", f"{'─' * 42}"]
        for t in targets:
            rate = rates.get(t)
            lines.append(f"  1 {base}  →  {rate:>14,.4f}  {t}" if rate else f"  {t}: Not available")
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def list_supported_currencies(query: str = "") -> str:
    """Returns supported currency codes. No input needed."""
    if not EXCHANGERATE_API_KEY:
        return "Error: EXCHANGERATE_API_KEY is not set."
    url = f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/codes"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("result") == "success":
            codes = data.get("supported_codes", [])
            formatted = "\n".join([f"  {c}: {n}" for c, n in codes[:50]])
            return f"Supported currencies (first 50 of {len(codes)}):\n{formatted}\n...and more."
        return "Could not retrieve currency list."
    except Exception as e:
        return f"Error: {str(e)}"


# ════════════════════════════════════════════════════════════
#  ★ NEW STAGE 3 TOOLS — CORRIDOR ANALYSIS ENGINE
# ════════════════════════════════════════════════════════════

@tool
def corridor_summary(query: str = "") -> str:
    """
    ★ STAGE 3 — Corridor Analysis ★
    Returns a summary of ALL corridors: total volume, transaction count,
    average spread %, and total fees paid. Great for a CFO overview.
    No input needed — just call it.
    Example query: "" or "all"
    """
    sql = """
        SELECT
            corridor,
            COUNT(*)                        AS tx_count,
            ROUND(SUM(amount_base), 2)      AS total_volume_base,
            ROUND(AVG(spread_pct), 4)       AS avg_spread_pct,
            ROUND(MAX(spread_pct), 4)       AS worst_spread_pct,
            ROUND(MIN(spread_pct), 4)       AS best_spread_pct,
            ROUND(SUM(fee_usd), 2)          AS total_fees_usd,
            base_currency
        FROM transactions
        GROUP BY corridor
        ORDER BY total_volume_base DESC
    """
    try:
        with get_db() as conn:
            rows = conn.execute(sql).fetchall()
        if not rows:
            return "No corridor data found. Run some conversions first or check seed data."

        lines = [
            "📊 Corridor Performance Summary",
            f"{'─' * 58}",
            f"{'Corridor':<12} {'Txns':>5} {'Volume':>14} {'Avg Spread':>11} {'Fees USD':>10}",
            f"{'─' * 58}",
        ]
        for r in rows:
            lines.append(
                f"{r['corridor']:<12} {r['tx_count']:>5} "
                f"{r['total_volume_base']:>14,.0f} {r['base_currency']} "
                f"{r['avg_spread_pct']:>10.3f}%  "
                f"${r['total_fees_usd']:>9,.2f}"
            )
        lines.append(f"{'─' * 58}")
        lines.append(f"Total corridors tracked: {len(rows)}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error querying corridor data: {str(e)}"


@tool
def corridor_deep_dive(query: str) -> str:
    """
    ★ STAGE 3 — Corridor Analysis ★
    Deep dive into a specific corridor. Shows spread trends,
    best/worst providers, and markup cost in USD.
    Input format: "BASE TARGET" or "BASE TARGET DAYS"
    Examples: "USD NGN", "USD NGN 30", "GBP EUR 90"
    """
    try:
        parts = clean_input(query).split()
        if len(parts) < 2:
            return "Invalid format. Use: 'BASE TARGET' or 'BASE TARGET DAYS'"
        base, target = parts[0].upper(), parts[1].upper()
        days = int(parts[2]) if len(parts) >= 3 else 30
    except Exception:
        return "Could not parse input."

    corridor = f"{base}>{target}"
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()

    sql_summary = """
        SELECT
            COUNT(*)                        AS tx_count,
            ROUND(SUM(amount_base), 2)      AS total_volume,
            ROUND(AVG(spread_pct), 4)       AS avg_spread,
            ROUND(MAX(spread_pct), 4)       AS worst_spread,
            ROUND(MIN(spread_pct), 4)       AS best_spread,
            ROUND(AVG(applied_rate), 6)     AS avg_rate,
            ROUND(SUM(fee_usd), 2)          AS total_fees,
            ROUND(
                SUM(amount_base * spread_pct / 100), 2
            )                               AS total_markup_cost
        FROM transactions
        WHERE corridor = ? AND timestamp >= ?
    """

    sql_providers = """
        SELECT
            provider,
            COUNT(*)                    AS tx_count,
            ROUND(AVG(spread_pct), 4)   AS avg_spread,
            ROUND(SUM(fee_usd), 2)      AS total_fees
        FROM transactions
        WHERE corridor = ? AND timestamp >= ?
        GROUP BY provider
        ORDER BY avg_spread ASC
    """

    try:
        with get_db() as conn:
            s = conn.execute(sql_summary, (corridor, since)).fetchone()
            providers = conn.execute(sql_providers, (corridor, since)).fetchall()

        if not s or s["tx_count"] == 0:
            return f"No data found for {corridor} in the last {days} days."

        lines = [
            f"🔍 Corridor Deep Dive: {base} → {target} (last {days} days)",
            f"{'─' * 50}",
            f"Transactions    : {s['tx_count']}",
            f"Total volume    : {s['total_volume']:,.2f} {base}",
            f"Avg applied rate: 1 {base} = {s['avg_rate']:.4f} {target}",
            f"Avg spread      : {s['avg_spread']:.3f}%",
            f"Best spread seen: {s['best_spread']:.3f}%",
            f"Worst spread    : {s['worst_spread']:.3f}%",
            f"Total fees paid : ${s['total_fees']:,.2f}",
            f"Total markup $  : ${s['total_markup_cost']:,.2f}  ← cost of not using mid-market",
            f"{'─' * 50}",
            "Provider Breakdown (best spread first):",
        ]
        for p in providers:
            lines.append(
                f"  {p['provider']:<14} {p['tx_count']:>3} txns  "
                f"avg spread {p['avg_spread']:.3f}%  fees ${p['total_fees']:,.2f}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def worst_corridors(query: str = "") -> str:
    """
    ★ STAGE 3 — Corridor Analysis ★
    Find the corridors with the highest average FX markup (worst spread).
    This is the CFO query: "Which corridors cost us the most?"
    Input: optional number of days e.g. "90" or "30". Defaults to 90.
    """
    try:
        days = int(clean_input(query)) if query.strip().isdigit() else 90
    except Exception:
        days = 90

    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    sql = """
        SELECT
            corridor,
            COUNT(*)                            AS tx_count,
            ROUND(AVG(spread_pct), 4)           AS avg_spread,
            ROUND(SUM(amount_base), 0)          AS total_volume,
            ROUND(SUM(amount_base * spread_pct / 100), 2) AS markup_cost_base,
            base_currency
        FROM transactions
        WHERE timestamp >= ?
        GROUP BY corridor
        HAVING tx_count >= 2
        ORDER BY avg_spread DESC
        LIMIT 8
    """
    try:
        with get_db() as conn:
            rows = conn.execute(sql, (since,)).fetchall()
        if not rows:
            return f"No data found in the last {days} days."

        lines = [
            f"⚠️  Worst-Performing Corridors (last {days} days)",
            f"{'─' * 55}",
            f"{'Corridor':<12} {'Avg Spread':>11} {'Txns':>5} {'Markup Cost':>14}",
            f"{'─' * 55}",
        ]
        for r in rows:
            lines.append(
                f"{r['corridor']:<12} {r['avg_spread']:>10.3f}%  "
                f"{r['tx_count']:>5}   "
                f"{r['markup_cost_base']:>10,.0f} {r['base_currency']}"
            )
        lines.append(f"{'─' * 55}")
        lines.append("Tip: corridors with high spread % are where your FX costs are leaking.")
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def best_corridors(query: str = "") -> str:
    """
    ★ STAGE 3 — Corridor Analysis ★
    Find the most efficient corridors (lowest spread / best rates).
    Input: optional number of days e.g. "30". Defaults to 90.
    """
    try:
        days = int(clean_input(query)) if query.strip().isdigit() else 90
    except Exception:
        days = 90

    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    sql = """
        SELECT
            corridor,
            COUNT(*)                  AS tx_count,
            ROUND(AVG(spread_pct), 4) AS avg_spread,
            ROUND(SUM(amount_base), 0) AS total_volume,
            base_currency
        FROM transactions
        WHERE timestamp >= ?
        GROUP BY corridor
        HAVING tx_count >= 2
        ORDER BY avg_spread ASC
        LIMIT 8
    """
    try:
        with get_db() as conn:
            rows = conn.execute(sql, (since,)).fetchall()
        if not rows:
            return f"No data found in the last {days} days."

        lines = [
            f"✅ Best-Performing Corridors (last {days} days)",
            f"{'─' * 50}",
            f"{'Corridor':<12} {'Avg Spread':>11} {'Txns':>5} {'Volume':>14}",
            f"{'─' * 50}",
        ]
        for r in rows:
            lines.append(
                f"{r['corridor']:<12} {r['avg_spread']:>10.3f}%  "
                f"{r['tx_count']:>5}  "
                f"{r['total_volume']:>10,.0f} {r['base_currency']}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def corridor_volume_trend(query: str) -> str:
    """
    ★ STAGE 3 — Corridor Analysis ★
    Show monthly volume breakdown for a specific corridor.
    Useful for treasury teams spotting seasonal patterns.
    Input format: "BASE TARGET"
    Examples: "USD NGN", "GBP EUR"
    """
    try:
        parts = clean_input(query).split()
        if len(parts) < 2:
            return "Invalid format. Use: 'BASE TARGET'"
        base, target = parts[0].upper(), parts[1].upper()
    except Exception:
        return "Could not parse input."

    corridor = f"{base}>{target}"
    sql = """
        SELECT
            STRFTIME('%Y-%m', timestamp)        AS month,
            COUNT(*)                            AS tx_count,
            ROUND(SUM(amount_base), 2)          AS volume,
            ROUND(AVG(spread_pct), 4)           AS avg_spread
        FROM transactions
        WHERE corridor = ?
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
    """
    try:
        with get_db() as conn:
            rows = conn.execute(sql, (corridor,)).fetchall()
        if not rows:
            return f"No data found for {corridor}."

        lines = [
            f"📅 Monthly Volume: {base} → {target}",
            f"{'─' * 48}",
            f"{'Month':<10} {'Txns':>5} {'Volume':>16} {'Avg Spread':>11}",
            f"{'─' * 48}",
        ]
        for r in rows:
            lines.append(
                f"{r['month']:<10} {r['tx_count']:>5}  "
                f"{r['volume']:>14,.2f}  {r['avg_spread']:>10.3f}%"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def log_manual_transaction(query: str) -> str:
    """
    ★ STAGE 3 — Corridor Analysis ★
    Manually log an FX transaction into the corridor database.
    Input format: "AMOUNT BASE TARGET APPLIED_RATE MID_RATE PROVIDER"
    Example: "50000 USD NGN 1545.00 1560.00 Wise"
    """
    try:
        parts = clean_input(query).split()
        if len(parts) < 6:
            return "Invalid format. Use: 'AMOUNT BASE TARGET APPLIED_RATE MID_RATE PROVIDER'"
        amount      = float(parts[0])
        base        = parts[1].upper()
        target      = parts[2].upper()
        applied_rate = float(parts[3])
        mid_rate    = float(parts[4])
        provider    = parts[5]
        received    = round(amount * applied_rate, 2)
    except Exception:
        return "Could not parse. Format: 'AMOUNT BASE TARGET APPLIED_RATE MID_RATE PROVIDER'"

    log_transaction(
        base=base, target=target,
        amount_base=amount, amount_target=received,
        mid_market_rate=mid_rate, applied_rate=applied_rate,
        provider=provider, notes="manual entry"
    )

    spread_pct = ((mid_rate - applied_rate) / mid_rate) * 100
    markup_cost = amount * spread_pct / 100

    return (
        f"✅ Transaction logged successfully.\n"
        f"Corridor    : {base} → {target}\n"
        f"Amount sent : {amount:,.2f} {base}\n"
        f"Received    : {received:,.2f} {target}\n"
        f"Spread      : {spread_pct:.3f}%\n"
        f"Markup cost : {markup_cost:,.2f} {base} vs mid-market\n"
        f"Provider    : {provider}"
    )


# ════════════════════════════════════════════════════════════
#  ★ NIGERIAN FINTECH TOOLS
# ════════════════════════════════════════════════════════════

@tool
def ngn_market_overview(query: str = "") -> str:
    """
    ★ NIGERIAN FINTECH — NGN Rate Intelligence ★
    Shows the official interbank rate vs parallel/BDC market rate for NGN.
    This is the critical dual-rate context every Nigerian fintech treasury team needs.
    Input: optional base currency e.g. "USD", "GBP", "EUR". Defaults to USD.
    """
    base = clean_input(query).upper().split()[0] if query.strip() else "USD"

    official_rate = get_rate_raw(base, "NGN")
    if not official_rate:
        return f"Could not fetch official {base}/NGN rate."

    # Try AbokiFX API for live parallel market rate
    abokifx_key = os.getenv("ABOKIFX_API_KEY")
    parallel_rate = None
    source = ""

    if abokifx_key:
        try:
            r = requests.get(
                "https://abokifx.com/api/v1/rates/movement",
                headers={
                    "Authorization": f"Bearer {abokifx_key}",
                    "Accept": "application/json",
                },
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                # AbokiFX response shape:
                # { "response": { "<timestamp>": [ { "currency_name": "GBP", "currency_rate": "2100 / 2120" }, ... ] } }
                response_block = data.get("response", {})
                if response_block:
                    # Get the most recent timestamp bucket (last key)
                    latest_key = sorted(response_block.keys())[-1]
                    rate_list = response_block[latest_key]
                    for entry in rate_list:
                        if entry.get("currency_name", "").upper() == base:
                            # currency_rate is "buying / selling" — we use the selling rate
                            raw_rate = entry.get("currency_rate", "")
                            parts = [p.strip() for p in raw_rate.split("/")]
                            if len(parts) == 2:
                                # Strip any non-numeric chars (asterisks, spaces)
                                selling_str = "".join(c for c in parts[1] if c.isdigit() or c == ".")
                                if selling_str:
                                    parallel_rate = float(selling_str)
                                    source = "AbokiFX (live parallel/BDC rate)"
                            break
        except Exception:
            pass

    if not parallel_rate:
        # Parallel market typically trades 5-15% above official in current NGN market.
        # This is a heuristic estimate — add ABOKIFX_API_KEY to .env for live data.
        parallel_rate = round(official_rate * 1.08, 2)
        source = "estimated (+8% above official) — add ABOKIFX_API_KEY to .env for live parallel rates"

    premium_pct = ((parallel_rate - official_rate) / official_rate) * 100
    cost_diff_per_1000 = round((parallel_rate - official_rate) * 1000, 0)

    # Pull the last 30 days of execution data from the DB for this corridor
    corridor = f"{base}>NGN"
    row = None
    try:
        with get_db() as conn:
            row = conn.execute("""
                SELECT
                    ROUND(AVG(spread_pct), 3)   AS avg_spread,
                    ROUND(AVG(applied_rate), 2) AS avg_rate,
                    COUNT(*)                    AS tx_count
                FROM transactions
                WHERE corridor = ?
                  AND timestamp >= DATE('now', '-30 days')
            """, (corridor,)).fetchone()
    except Exception:
        pass

    lines = [
        f"NGN Rate Intelligence: {base}/NGN",
        f"{'─' * 46}",
        f"Official interbank rate : {official_rate:>10,.2f} NGN",
        f"Parallel / BDC rate     : {parallel_rate:>10,.2f} NGN  [{source}]",
        f"Premium above official  : {premium_pct:>10.2f}%",
        f"Cost difference         : {cost_diff_per_1000:>10,.0f} NGN per {base}1,000 sent",
        f"{'─' * 46}",
    ]

    if row and row["tx_count"] > 0:
        effective_gap = ((row["avg_rate"] - official_rate) / official_rate) * 100
        direction = "below" if effective_gap < 0 else "above"
        lines += [
            f"Your last 30 days on {corridor}:",
            f"  Avg applied rate : {row['avg_rate']:>10,.2f} NGN",
            f"  Avg spread       : {row['avg_spread']:>10.3f}%",
            f"  Transactions     : {row['tx_count']}",
            f"  vs official rate : {abs(effective_gap):.2f}% {direction} interbank",
        ]
    else:
        lines.append(f"No recent {corridor} transactions in the database.")

    lines += [
        f"{'─' * 46}",
        "Context: Nigerian fintechs source NGN liquidity between the official",
        "interbank and parallel rate. Your actual cost depends on your",
        "liquidity provider (Stanbic IBTC, Access Bank, Fidelity, etc.)",
        "and the spread negotiated with them.",
    ]
    return "\n".join(lines)


@tool
def diaspora_corridor_summary(query: str = "") -> str:
    """
    ★ NIGERIAN FINTECH — Diaspora Remittance Overview ★
    Summary of all inbound NGN corridors: GBP, USD, EUR, CAD → NGN.
    The core view for Nigerian remittance fintech treasury teams.
    Input: optional number of days e.g. "30" or "90". Defaults to 90.
    """
    try:
        days = int(clean_input(query)) if query.strip().isdigit() else 90
    except Exception:
        days = 90

    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    sql = """
        SELECT
            corridor,
            base_currency,
            COUNT(*)                                        AS tx_count,
            ROUND(SUM(amount_base), 0)                     AS total_volume,
            ROUND(AVG(spread_pct), 4)                      AS avg_spread,
            ROUND(AVG(applied_rate), 2)                    AS avg_rate,
            ROUND(SUM(fee_usd), 2)                         AS total_fees,
            ROUND(SUM(amount_base * spread_pct / 100), 2)  AS markup_cost
        FROM transactions
        WHERE target_currency = 'NGN'
          AND timestamp >= ?
        GROUP BY corridor
        ORDER BY total_volume DESC
    """
    try:
        with get_db() as conn:
            rows = conn.execute(sql, (since,)).fetchall()

        if not rows:
            return f"No inbound NGN corridor data found in the last {days} days."

        total_markup = sum(r["markup_cost"] for r in rows)
        total_txns   = sum(r["tx_count"] for r in rows)

        lines = [
            f"Diaspora Remittance Corridors — Inbound to NGN (last {days} days)",
            f"{'─' * 64}",
            f"{'Corridor':<12} {'Txns':>5} {'Volume':>16} {'Avg Rate':>12} {'Spread':>8} {'Markup Cost':>14}",
            f"{'─' * 64}",
        ]
        for r in rows:
            lines.append(
                f"{r['corridor']:<12} {r['tx_count']:>5}  "
                f"{r['total_volume']:>12,.0f} {r['base_currency']}  "
                f"{r['avg_rate']:>10,.2f}  "
                f"{r['avg_spread']:>7.3f}%  "
                f"{r['markup_cost']:>11,.2f} {r['base_currency']}"
            )
        lines += [
            f"{'─' * 64}",
            f"Total transactions : {total_txns}",
            f"Total markup cost  : {total_markup:,.2f} (mixed base currencies)",
            "",
            "Tip: corridors with spread above 3% on NGN are prime targets for",
            "provider renegotiation or routing to a cheaper liquidity source.",
        ]
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {str(e)}"


# ════════════════════════════════════════════════════════════
#  PROMPT
# ════════════════════════════════════════════════════════════

today_str = datetime.today().strftime("%A, %B %d, %Y")

PROMPT_TEMPLATE = (
    "You are FXAgent, an FX intelligence assistant built specifically for Nigerian fintech\n"
    "companies operating cross-border and diaspora remittance payment corridors.\n\n"
    f"Today's date: {today_str}\n\n"
    "You serve treasury teams, CFOs, and finance operations staff at fintechs focused on:\n"
    "- Diaspora remittance into Nigeria: GBP/USD/EUR/CAD → NGN\n"
    "- Pan-African cross-border payments: GHS, KES, XOF, ZAR corridors\n"
    "- Liquidity provider optimisation: Stanbic IBTC, Access Bank, Fidelity Bank,\n"
    "  Ecobank, Verto FX, Flutterwave, Nium\n\n"
    "Critical NGN context you must always apply:\n"
    "- Nigeria operates with TWO rates: the official/interbank (CBN/NAFEX) rate and\n"
    "  the parallel/BDC (Bureau de Change) rate. Always clarify which applies.\n"
    "  The parallel rate typically trades 5-15% above the official rate.\n"
    "- A spread above 3% on any NGN corridor is a red flag — flag it proactively.\n"
    "- GBP→NGN is usually the highest-volume corridor for UK diaspora fintechs.\n"
    "- CAD→NGN is a growing corridor with thinner liquidity — expect higher spreads.\n"
    "- XOF is the shared currency of 8 UEMOA countries (Senegal, Côte d'Ivoire, etc.).\n"
    "- Always translate spread % into real currency cost (e.g. cost per ₦1,000 sent).\n\n"
    "You have three modes:\n"
    "1. LIVE FX — real-time rates, conversions, trends, multi-currency snapshots\n"
    "2. CORRIDOR ANALYST — corridor performance, spreads, provider comparison, markup cost\n"
    "3. NGN INTELLIGENCE — official vs parallel rate, diaspora remittance overview\n\n"
    "When asked if it is safe or a good time to transact on any corridor:\n"
    "1. Always fetch the live rate first using get_exchange_rate.\n"
    "2. Fetch 7-day and 30-day historical rates using get_historical_rate to assess volatility.\n"
    "3. Compare today's rate to the 7-day and 30-day averages — is it better or worse than usual?\n"
    "4. Give a concrete YES or NO recommendation with a clear reason.\n"
    "5. If you have no internal transaction history for the corridor, say so — but still give\n"
    "   a rate-based recommendation using the live and historical data you fetched.\n"
    "Never say you 'lack data' and stop there. Always go further with what you can fetch.\n\n"
    "Conversation history:\n"
    "{chat_history}\n\n"
    "Formatting rules:\n"
    "- NEVER use markdown syntax. No ## headers, no ** bold, no * bullets, no | tables.\n"
    "- Lead with the key insight, then show the supporting data.\n"
    "- Always express spread % in real currency terms when relevant.\n"
    "- Use currency symbols: ₦ for NGN, £ for GBP, $ for USD, € for EUR, C$ for CAD.\n"
    "- Be analytical and direct. Nigerian fintech treasury teams want numbers, not fluff.\n"
    "- Use plain text only. Structure with line breaks and spacing, not markdown.\n"
    "- For lists use a dash (-), never asterisks (*) or hashes (#).\n\n"
    "Available tools:\n"
    "{tools}\n\n"
    "Use this EXACT format:\n\n"
    "Question: the input question\n"
    "Thought: reason step by step\n"
    "Action: one of [{tool_names}]\n"
    "Action Input: raw string input for the tool\n"
    "Observation: the tool result\n"
    "... (repeat as needed)\n"
    "Thought: I now have enough to answer\n"
    "Final Answer: clear, professional, analytical response\n\n"
    "Begin!\n\n"
    "Question: {input}\n"
    "Thought: {agent_scratchpad}"
)

prompt = PromptTemplate.from_template(PROMPT_TEMPLATE)


def build_tenant_prompt(config: dict) -> PromptTemplate:
    """Build a personalised system prompt from tenant onboarding config."""
    company      = config.get("company_name", "your company")
    corridors    = config.get("corridors", [])
    providers    = config.get("providers", [])
    threshold    = config.get("spread_threshold", 3.0)
    today        = datetime.today().strftime("%A, %B %d, %Y")
    corridor_str = ", ".join(corridors) if corridors else "all corridors"
    provider_str = ", ".join(providers) if providers else "all providers"

    template = (
        f"You are FXAgent, an FX intelligence assistant for {company}.\n\n"
        f"Today's date: {today}\n\n"
        f"Active corridors for {company}: {corridor_str}\n"
        f"Liquidity providers: {provider_str}\n"
        f"Spread alert threshold: {threshold}% — proactively flag any corridor exceeding this.\n\n"
        "You serve treasury teams, CFOs, and finance operations staff.\n\n"
        "Critical NGN context:\n"
        "- Nigeria has TWO rates: official/interbank (CBN/NAFEX) and parallel/BDC.\n"
        "  Always clarify which applies. Parallel typically trades 5-15% above official.\n"
        "- Always translate spread % into real currency cost per unit sent.\n"
        "- Use currency symbols: ₦ NGN, £ GBP, $ USD, € EUR, C$ CAD.\n\n"
        "When asked if it is safe or a good time to transact on any corridor:\n"
        "1. Always fetch the live rate first using get_exchange_rate.\n"
        "2. Then fetch 7-day and 30-day historical rates using get_historical_rate to assess volatility.\n"
        "3. Compare today's rate to the 7-day and 30-day averages — is the rate better or worse than usual?\n"
        "4. Give a concrete YES or NO recommendation with a reason.\n"
        "5. If you have no internal transaction history for the corridor, say so clearly — but still give\n"
        "   a rate-based recommendation using the live and historical data you fetched.\n"
        "Never say you 'lack data' and stop there. Always go further with what you can fetch.\n\n"
        "Conversation history:\n{chat_history}\n\n"
        "Formatting rules:\n"
        "- NEVER use markdown. No ## headers, no ** bold, no * bullets.\n"
        "- Lead with key insight, then supporting data.\n"
        "- Plain text only. Use dashes (-) for lists.\n\n"
        "Available tools:\n{tools}\n\n"
        "Use this EXACT format:\n\n"
        "Question: the input question\n"
        "Thought: reason step by step\n"
        "Action: one of [{tool_names}]\n"
        "Action Input: raw string input for the tool\n"
        "Observation: the tool result\n"
        "... (repeat as needed)\n"
        "Thought: I now have enough to answer\n"
        "Final Answer: clear, professional, analytical response\n\n"
        "Begin!\n\n"
        "Question: {input}\n"
        "Thought: {agent_scratchpad}"
    )
    return PromptTemplate.from_template(template)


# ════════════════════════════════════════════════════════════
#  AGENT SETUP
# ════════════════════════════════════════════════════════════

tools = [
    get_exchange_rate,
    convert_currency,
    get_historical_rate,
    analyze_trend,
    multi_currency_snapshot,
    list_supported_currencies,
    corridor_summary,
    corridor_deep_dive,
    worst_corridors,
    best_corridors,
    corridor_volume_trend,
    log_manual_transaction,
    ngn_market_overview,
    diaspora_corridor_summary,
]

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

# ════════════════════════════════════════════════════════════
#  SESSION STORE
#  _tenant_agents  : one LangChain agent per tenant (prompt is tenant-specific)
#  _session_executors : one AgentExecutor per (tenant, session) for memory isolation
# ════════════════════════════════════════════════════════════

_tenant_agents: dict     = {}
_session_executors: dict = {}

# Keep _sessions as an alias so existing server.py delete logic still works
_sessions = _session_executors


def get_session_executor(session_id: str, tenant_id: str = "default") -> AgentExecutor:
    key = f"{tenant_id}:{session_id}"
    if key not in _session_executors:
        # Build or reuse the tenant-specific agent
        if tenant_id not in _tenant_agents:
            config = get_tenant_config_db(tenant_id)
            tenant_prompt = build_tenant_prompt(config) if config else prompt
            _tenant_agents[tenant_id] = create_react_agent(
                llm=llm, tools=tools, prompt=tenant_prompt
            )
        session_memory = ConversationBufferWindowMemory(
            memory_key="chat_history",
            k=10,
            return_messages=False,
        )
        _session_executors[key] = AgentExecutor(
            agent=_tenant_agents[tenant_id],
            tools=tools,
            memory=session_memory,
            verbose=True,
            max_iterations=20,
            handle_parsing_errors=True,
        )
    return _session_executors[key]


# ════════════════════════════════════════════════════════════
#  STARTUP & RUN
# ════════════════════════════════════════════════════════════

def chat():
    init_db()
    seed_demo_data()

    print("\n💱 FXAgent — Nigerian Fintech Edition")
    print("=" * 60)
    print("FX intelligence for cross-border & diaspora remittance fintechs")
    print("\nTry these treasury queries:")
    print("  → 'Give me the NGN market overview for GBP'")
    print("  → 'Show me all our diaspora remittance corridors'")
    print("  → 'Which corridors had the worst FX markup last 90 days?'")
    print("  → 'Deep dive into the GBP to NGN corridor'")
    print("  → 'Who is our best provider on USD to NGN?'")
    print("  → 'What is the current GBP to NGN rate vs 30 days ago?'")
    print("  → 'Show me monthly volume for USD to GHS'")
    print("\nType 'exit' to quit.\n")

    executor = get_session_executor("cli", "default")

    while True:
        user_input = input("You: ").strip()
        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "bye"):
            print("FXAgent: Goodbye! Safe transactions ahead 💰")
            break

        try:
            result = executor.invoke({"input": user_input})
            print(f"\nFXAgent: {result['output']}\n")
        except Exception as e:
            print(f"\nFXAgent: Error — {str(e)}\n")


if __name__ == "__main__":
    chat()