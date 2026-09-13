# Sneaker Deal Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `server/` FastAPI backend that takes a scraped deal from Apify through a Telegram review step (Reject / Post Only / Create Order), renders a branded banner with Pillow, publishes it to a Telegram channel, and — for Create Order — appends a real Pending order to DripIT's Google Sheet.

**Architecture:** A small set of single-responsibility modules (`config`, `models`, `bots`, `sheets_client`, `image_engine`) wired together by `main.py`'s `create_app(settings)` factory. The only shared state with the existing React app is the Google Sheet, reached through the same Apps Script Web App URL DripIT already uses — extended with one new tab (`pendingDeals`) and one new column (`orders.company`).

**Tech Stack:** Python 3.11, FastAPI + Uvicorn, httpx (async), Pillow ≥10.1 (bundled scalable font — no external TTF needed), Pydantic v2. Tests: pytest + pytest-asyncio + respx (mocks httpx at the transport level — no real network calls in the suite).

**Spec:** `docs/superpowers/specs/2026-09-14-sneaker-deal-pipeline-design.md`

## Global Constraints

- Python 3.11 (pinned via `server/runtime.txt` for Render).
- Pin exact versions: `fastapi==0.110.0`, `uvicorn==0.28.0`, `httpx==0.27.0`, `Pillow==10.3.0`, `python-multipart==0.0.9`, `pydantic==2.6.4`. Dev-only: `pytest==8.1.1`, `pytest-asyncio==0.23.6`, `respx==0.21.1`.
- Every Telegram caption must pass through `bots.escape_markdown()` before being sent — `parse_mode` is the legacy `"Markdown"` mode throughout (matches the original prototype), which only requires escaping `_ * `` [`.
- The Sheets Apps Script `save` action replaces the **entire row** by `id` — it does not merge. Any partial update must go through `SheetsClient.update_pending_deal()` (read-merge-write), never a bare partial dict sent straight to `save_row()`.
- No module does network I/O or reads environment variables at import time, **except** the last line of `main.py` (`app = create_app(load_settings())`). Every other module must be safely importable with no environment configured, so tests can import them freely.
- All new tests must pass with zero real network access — every `httpx` call in a test is intercepted by `respx`.
- Run tests from `server/`: `pytest -v`.

---

### Task 1: Backend scaffolding + configuration

**Files:**
- Create: `server/config.py`
- Create: `server/requirements.txt`
- Create: `server/requirements-dev.txt`
- Create: `server/Procfile`
- Create: `server/runtime.txt`
- Create: `server/pytest.ini`
- Create: `server/tests/test_config.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `config.ConfigError` (exception), `config.Settings` (dataclass with fields `reviewer_bot_token: str`, `publisher_bot_token: str`, `telegram_chat_id: int`, `telegram_allowed_user_ids: list[int]`, `telegram_webhook_secret: str`, `apify_webhook_secret: str`, `sheets_url: str`, `deal_brand: str`), `config.load_settings(env: dict | None = None) -> Settings`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_config.py`:

```python
import pytest

from config import ConfigError, load_settings

BASE_ENV = {
    "REVIEWER_BOT_TOKEN": "r-token",
    "PUBLISHER_BOT_TOKEN": "p-token",
    "TELEGRAM_CHAT_ID": "-1001234567890",
    "TELEGRAM_ALLOWED_USER_IDS": "111, 222",
    "TELEGRAM_WEBHOOK_SECRET": "wh-secret",
    "APIFY_WEBHOOK_SECRET": "apify-secret",
    "SHEETS_URL": "https://script.google.com/macros/s/test/exec",
    "DEAL_BRAND": "drip_ittt",
}


def test_load_settings_parses_valid_env():
    settings = load_settings(dict(BASE_ENV))
    assert settings.reviewer_bot_token == "r-token"
    assert settings.telegram_chat_id == -1001234567890
    assert settings.telegram_allowed_user_ids == [111, 222]
    assert settings.deal_brand == "drip_ittt"


def test_load_settings_raises_on_missing_var():
    env = dict(BASE_ENV)
    del env["REVIEWER_BOT_TOKEN"]
    with pytest.raises(ConfigError, match="REVIEWER_BOT_TOKEN"):
        load_settings(env)


def test_load_settings_raises_on_invalid_brand():
    env = dict(BASE_ENV)
    env["DEAL_BRAND"] = "SomeOtherBrand"
    with pytest.raises(ConfigError):
        load_settings(env)


def test_load_settings_raises_on_non_integer_chat_id():
    env = dict(BASE_ENV)
    env["TELEGRAM_CHAT_ID"] = "not-a-number"
    with pytest.raises(ConfigError):
        load_settings(env)


def test_load_settings_raises_on_non_integer_allowed_ids():
    env = dict(BASE_ENV)
    env["TELEGRAM_ALLOWED_USER_IDS"] = "111,not-a-number"
    with pytest.raises(ConfigError):
        load_settings(env)
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `pytest tests/test_config.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'config'` (and no `pytest.ini` yet, so this step also confirms the harness needs setting up).

- [ ] **Step 3: Create the scaffolding files**

Create `server/pytest.ini`:

```ini
[pytest]
pythonpath = .
asyncio_mode = auto
```

Create `server/requirements.txt`:

```text
fastapi==0.110.0
uvicorn==0.28.0
httpx==0.27.0
Pillow==10.3.0
python-multipart==0.0.9
pydantic==2.6.4
```

Create `server/requirements-dev.txt`:

```text
-r requirements.txt
pytest==8.1.1
pytest-asyncio==0.23.6
respx==0.21.1
```

Create `server/Procfile`:

```text
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

Create `server/runtime.txt`:

```text
python-3.11.9
```

Append to `.gitignore` (repo root):

```text

# Python (server/)
__pycache__/
*.pyc
.pytest_cache/
server/.venv
```

- [ ] **Step 4: Write `config.py`**

Create `server/config.py`:

```python
"""Environment configuration for the sneaker deal pipeline backend.

Settings is a plain dataclass so it can be constructed directly in tests
without touching real environment variables. `load_settings()` is the only
function that reads `os.environ`, and only when called explicitly — this
module has no import-time side effects.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

VALID_BRANDS = ("drip_ittt", "NOVUS")


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


@dataclass
class Settings:
    reviewer_bot_token: str
    publisher_bot_token: str
    telegram_chat_id: int
    telegram_allowed_user_ids: list[int]
    telegram_webhook_secret: str
    apify_webhook_secret: str
    sheets_url: str
    deal_brand: str

    def __post_init__(self) -> None:
        if self.deal_brand not in VALID_BRANDS:
            raise ConfigError(
                f"deal_brand must be one of {VALID_BRANDS}, got {self.deal_brand!r}"
            )


def _require(env: dict, name: str) -> str:
    value = (env.get(name) or "").strip()
    if not value:
        raise ConfigError(f"Missing required environment variable: {name}")
    return value


def load_settings(env: dict | None = None) -> Settings:
    """Build Settings from environment variables (defaults to os.environ).

    Pass an explicit `env` mapping to load from something other than the
    real environment, e.g. in tests.
    """
    env = os.environ if env is None else env

    try:
        chat_id = int(_require(env, "TELEGRAM_CHAT_ID"))
    except ValueError as exc:
        raise ConfigError("TELEGRAM_CHAT_ID must be an integer") from exc

    allowed_raw = _require(env, "TELEGRAM_ALLOWED_USER_IDS")
    try:
        allowed_ids = [int(part.strip()) for part in allowed_raw.split(",") if part.strip()]
    except ValueError as exc:
        raise ConfigError(
            "TELEGRAM_ALLOWED_USER_IDS must be a comma-separated list of integers"
        ) from exc

    return Settings(
        reviewer_bot_token=_require(env, "REVIEWER_BOT_TOKEN"),
        publisher_bot_token=_require(env, "PUBLISHER_BOT_TOKEN"),
        telegram_chat_id=chat_id,
        telegram_allowed_user_ids=allowed_ids,
        telegram_webhook_secret=_require(env, "TELEGRAM_WEBHOOK_SECRET"),
        apify_webhook_secret=_require(env, "APIFY_WEBHOOK_SECRET"),
        sheets_url=_require(env, "SHEETS_URL"),
        deal_brand=_require(env, "DEAL_BRAND"),
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `server/`): `pip install -r requirements-dev.txt && pytest tests/test_config.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add server/config.py server/requirements.txt server/requirements-dev.txt server/Procfile server/runtime.txt server/pytest.ini server/tests/test_config.py .gitignore
git commit -m "server: add backend scaffolding and env config loader"
```

---

### Task 2: Extend the shared Apps Script schema (`orders.company` + `pendingDeals`)

**Files:**
- Modify: `src/App.jsx` (the `appsScriptCode` template string, `HEADERS` constant — currently around line 4973)

**Interfaces:**
- Produces: the `pendingDeals` entity and `orders.company` column that `server/sheets_client.py` (Task 5) writes to and reads from.

- [ ] **Step 1: Locate and update the `HEADERS` map**

In `src/App.jsx`, find:

```javascript
const HEADERS = {
  orders:   ['id','orderNumber','customerName','customerPhone','customerFb','productName','productDescription','costPriceRM','conversionRate','multiplier','status','orderDate','advancePaid','deliveryDate','notes'],
  expenses: ['id','date','description','category','amount','currency'],
  ledger:   ['id','date','direction','type','account','party','amount','currency','description','kind','relatedOrderId'],
  loans:    ['id','type','party','principal','currency','amountRepaid','status','date','dueDate','notes'],
  invoices: ['id','invoiceNumber','date','subtotal','discount','total'],
  accounts: ['id','name','type','currency','openingBalance'],
  counters: ['id','orderSeq','invoiceSeq','receiptSeq'],
};
```

Replace it with:

```javascript
const HEADERS = {
  orders:   ['id','company','orderNumber','customerName','customerPhone','customerFb','productName','productDescription','costPriceRM','conversionRate','multiplier','status','orderDate','advancePaid','deliveryDate','notes'],
  expenses: ['id','date','description','category','amount','currency'],
  ledger:   ['id','date','direction','type','account','party','amount','currency','description','kind','relatedOrderId'],
  loans:    ['id','type','party','principal','currency','amountRepaid','status','date','dueDate','notes'],
  invoices: ['id','invoiceNumber','date','subtotal','discount','total'],
  accounts: ['id','name','type','currency','openingBalance'],
  counters: ['id','orderSeq','invoiceSeq','receiptSeq'],
  pendingDeals: ['id','title','myr_price','sizes','image_url','status','pending_action','created_at'],
};
```

This adds `company` as a real column DripIT's own Sheets sync now writes and reads for every order (fixing the pre-existing gap where `company` was silently dropped on every Sheets round-trip — see spec Section 6), and adds the `pendingDeals` tab the backend uses as its durable queue. Nothing else about `doPost`/`doGet`/`getSheet` needs to change — both are driven generically off `HEADERS`.

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds with no errors (this is a plain string literal edit — the check here is that the JSX/template-literal syntax is still valid).

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "app: add company column and pendingDeals tab to generated Apps Script"
```

> **Note for rollout (not part of this task):** this change only takes effect once the user re-copies the generated Apps Script code (Export & Sync tab → "Show Apps Script Code") into their deployed script.google.com project and redeploys it. Task 10 documents this as an explicit rollout step.

---

### Task 3: `models.py` — Pydantic schemas

**Files:**
- Create: `server/models.py`
- Create: `server/tests/test_models.py`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `models.ScraperDeal` (Pydantic model: `deal_id: str`, `title: str`, `myr_price: float`, `sizes: str`, `image_url: str`), `models.PENDING_STATUSES` (tuple), `models.PENDING_ACTIONS` (tuple, values `"postonly"`, `"createorder"`).

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_models.py`:

```python
import pytest
from pydantic import ValidationError

from models import PENDING_ACTIONS, PENDING_STATUSES, ScraperDeal


def test_scraper_deal_parses_valid_payload():
    deal = ScraperDeal(
        deal_id="d1", title="Air Max 90", myr_price=350, sizes="40,41", image_url="https://x/img.jpg"
    )
    assert deal.myr_price == 350.0


def test_scraper_deal_coerces_price_string_with_currency_prefix():
    deal = ScraperDeal(
        deal_id="d1", title="Air Max 90", myr_price="RM 350.50", sizes="40", image_url="https://x/img.jpg"
    )
    assert deal.myr_price == 350.5


def test_scraper_deal_requires_title():
    with pytest.raises(ValidationError):
        ScraperDeal(deal_id="d1", myr_price=350, sizes="40", image_url="https://x/img.jpg")


def test_pending_action_constants_match_callback_data_values():
    assert PENDING_ACTIONS == ("postonly", "createorder")
    assert "awaiting_price" in PENDING_STATUSES
    assert "published" in PENDING_STATUSES
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'models'`

- [ ] **Step 3: Write `models.py`**

Create `server/models.py`:

```python
"""Pydantic schemas and shared constants for the deal pipeline."""
from __future__ import annotations

from pydantic import BaseModel, field_validator

PENDING_STATUSES = ("awaiting_review", "awaiting_price", "processing", "published", "rejected")
PENDING_ACTIONS = ("postonly", "createorder")


class ScraperDeal(BaseModel):
    deal_id: str
    title: str
    myr_price: float
    sizes: str
    image_url: str

    @field_validator("myr_price", mode="before")
    @classmethod
    def _parse_price(cls, value):
        if isinstance(value, str):
            value = value.upper().replace("RM", "").replace(",", "").strip()
        return float(value)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/models.py server/tests/test_models.py
git commit -m "server: add ScraperDeal schema and pipeline status constants"
```

---

### Task 4: `bots.py` — Markdown escaping + Telegram Bot API wrapper

**Files:**
- Create: `server/bots.py`
- Create: `server/tests/test_bots.py`

**Interfaces:**
- Consumes: `httpx` directly (no dependency on earlier tasks' modules).
- Produces: `bots.escape_markdown(text: str) -> str`; `bots.TelegramError` (exception); `bots.TelegramBot(token: str, client: httpx.AsyncClient | None = None)` with async methods `send_review_card(chat_id, photo_url, caption, deal_id) -> dict`, `answer_callback(callback_id, text) -> dict`, `delete_message(chat_id, message_id) -> dict`, `send_force_reply(chat_id, text) -> dict`, `send_message(chat_id, text) -> dict`, `publish_photo(chat_id, image_bytes, caption) -> dict`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_bots.py`:

```python
import json

import httpx
import pytest
import respx

from bots import TelegramBot, TelegramError, escape_markdown


def test_escape_markdown_escapes_special_characters():
    assert escape_markdown("Air_Jordan*4 [Retro]") == r"Air\_Jordan\*4 \[Retro]"


def test_escape_markdown_handles_empty_string():
    assert escape_markdown("") == ""
    assert escape_markdown(None) == ""


@respx.mock
async def test_send_review_card_posts_photo_with_three_buttons():
    route = respx.post("https://api.telegram.org/bot123:ABC/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    bot = TelegramBot("123:ABC")

    await bot.send_review_card(chat_id=-100, photo_url="https://x/img.jpg", caption="hi", deal_id="d1")

    assert route.called
    body = json.loads(route.calls.last.request.content)
    assert body["chat_id"] == -100
    buttons = body["reply_markup"]["inline_keyboard"][0]
    assert [b["callback_data"] for b in buttons] == ["reject:d1", "postonly:d1", "createorder:d1"]


@respx.mock
async def test_publish_photo_sends_multipart_file():
    route = respx.post("https://api.telegram.org/bot123:ABC/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    bot = TelegramBot("123:ABC")

    await bot.publish_photo(chat_id=-100, image_bytes=b"fake-png-bytes", caption="hello")

    assert route.called
    request = route.calls.last.request
    assert b"fake-png-bytes" in request.content


@respx.mock
async def test_telegram_error_raised_on_failure_response():
    respx.post("https://api.telegram.org/bot123:ABC/sendMessage").mock(
        return_value=httpx.Response(400, json={"ok": False, "description": "bad request"})
    )
    bot = TelegramBot("123:ABC")

    with pytest.raises(TelegramError):
        await bot.send_message(chat_id=-100, text="hi")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bots.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'bots'`

- [ ] **Step 3: Write `bots.py`**

Create `server/bots.py`:

```python
"""Telegram Bot API wrapper: Markdown escaping and the handful of calls the
pipeline needs (send/edit/delete/publish). Every outbound Telegram call in
this project must go through TelegramBot — no ad hoc httpx calls elsewhere.
"""
from __future__ import annotations

import re

import httpx

_MARKDOWN_SPECIAL_CHARS = re.compile(r"([_*`\[])")


def escape_markdown(text: str | None) -> str:
    """Escape the characters Telegram's legacy Markdown parser treats as
    formatting (_ * ` [) so arbitrary scraped/user text can't break message
    formatting or fail the API call with a 400."""
    if not text:
        return ""
    return _MARKDOWN_SPECIAL_CHARS.sub(r"\\\1", text)


class TelegramError(RuntimeError):
    """Raised when a Telegram Bot API call returns a non-2xx response."""


class TelegramBot:
    def __init__(self, token: str, client: httpx.AsyncClient | None = None):
        self._base_url = f"https://api.telegram.org/bot{token}"
        self._client = client or httpx.AsyncClient(timeout=30.0)

    async def _post(self, method: str, **kwargs) -> dict:
        response = await self._client.post(f"{self._base_url}/{method}", **kwargs)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise TelegramError(f"{method} failed: {response.status_code} {response.text}") from exc
        return response.json()

    async def send_review_card(self, chat_id: int, photo_url: str, caption: str, deal_id: str) -> dict:
        keyboard = {
            "inline_keyboard": [[
                {"text": "❌ Reject", "callback_data": f"reject:{deal_id}"},
                {"text": "\U0001f5bc Post Only", "callback_data": f"postonly:{deal_id}"},
                {"text": "✅ Create Order", "callback_data": f"createorder:{deal_id}"},
            ]]
        }
        return await self._post(
            "sendPhoto",
            json={
                "chat_id": chat_id,
                "photo": photo_url,
                "caption": caption,
                "parse_mode": "Markdown",
                "reply_markup": keyboard,
            },
        )

    async def answer_callback(self, callback_id: str, text: str) -> dict:
        return await self._post(
            "answerCallbackQuery", json={"callback_query_id": callback_id, "text": text}
        )

    async def delete_message(self, chat_id: int, message_id: int) -> dict:
        return await self._post("deleteMessage", json={"chat_id": chat_id, "message_id": message_id})

    async def send_force_reply(self, chat_id: int, text: str) -> dict:
        return await self._post(
            "sendMessage",
            json={"chat_id": chat_id, "text": text, "reply_markup": {"force_reply": True}},
        )

    async def send_message(self, chat_id: int, text: str) -> dict:
        return await self._post("sendMessage", json={"chat_id": chat_id, "text": text})

    async def publish_photo(self, chat_id: int, image_bytes: bytes, caption: str) -> dict:
        return await self._post(
            "sendPhoto",
            data={"chat_id": chat_id, "caption": caption, "parse_mode": "Markdown"},
            files={"photo": ("banner.png", image_bytes, "image/png")},
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bots.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/bots.py server/tests/test_bots.py
git commit -m "server: add Telegram bot wrapper with Markdown escaping"
```

---

### Task 5: `sheets_client.py` — Google Sheets read/write wrapper

**Files:**
- Create: `server/sheets_client.py`
- Create: `server/tests/test_sheets_client.py`

**Interfaces:**
- Consumes: `httpx` directly.
- Produces: `sheets_client.SheetsError` (exception); `sheets_client.SheetsClient(base_url: str, client: httpx.AsyncClient | None = None)` with async methods `list_rows(entity: str) -> list[dict]`, `save_row(entity: str, data: dict) -> None`, `get_pending_deal(deal_id: str) -> dict | None`, `create_pending_deal(data: dict) -> None`, `update_pending_deal(deal_id: str, **changes) -> dict` (raises `SheetsError` if the deal doesn't exist), `append_order(order: dict) -> None`, `next_order_number(brand: str) -> str`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_sheets_client.py`:

```python
import json

import httpx
import pytest
import respx

from sheets_client import SheetsClient, SheetsError

URL = "https://script.google.com/macros/s/test/exec"


@respx.mock
async def test_list_rows_returns_data_on_success():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": [{"id": "d1"}]})
    )
    rows = await SheetsClient(URL).list_rows("pendingDeals")
    assert rows == [{"id": "d1"}]


@respx.mock
async def test_list_rows_raises_on_ok_false():
    respx.get(URL, params={"action": "list", "entity": "orders"}).mock(
        return_value=httpx.Response(200, json={"ok": False, "error": "boom"})
    )
    with pytest.raises(SheetsError):
        await SheetsClient(URL).list_rows("orders")


@respx.mock
async def test_get_pending_deal_finds_matching_row():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(
            200, json={"ok": True, "data": [{"id": "d1", "title": "A"}, {"id": "d2", "title": "B"}]}
        )
    )
    row = await SheetsClient(URL).get_pending_deal("d2")
    assert row == {"id": "d2", "title": "B"}


@respx.mock
async def test_get_pending_deal_returns_none_when_missing():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    assert await SheetsClient(URL).get_pending_deal("missing") is None


@respx.mock
async def test_update_pending_deal_merges_and_saves_full_row():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(
            200, json={"ok": True, "data": [{"id": "d1", "title": "A", "status": "awaiting_review"}]}
        )
    )
    save_route = respx.post(URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    merged = await SheetsClient(URL).update_pending_deal(
        "d1", status="awaiting_price", pending_action="postonly"
    )

    assert merged == {
        "id": "d1", "title": "A", "status": "awaiting_price", "pending_action": "postonly"
    }
    sent = json.loads(save_route.calls.last.request.content)
    assert sent["entity"] == "pendingDeals"
    assert sent["data"]["title"] == "A"  # untouched field preserved, not dropped
    assert sent["data"]["status"] == "awaiting_price"


@respx.mock
async def test_update_pending_deal_raises_when_not_found():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    with pytest.raises(SheetsError):
        await SheetsClient(URL).update_pending_deal("missing", status="rejected")


@respx.mock
async def test_next_order_number_increments_existing_counter():
    respx.get(URL, params={"action": "list", "entity": "counters"}).mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "data": [{"id": "drip_ittt", "orderSeq": 41, "invoiceSeq": 10, "receiptSeq": 5}]},
        )
    )
    save_route = respx.post(URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    number = await SheetsClient(URL).next_order_number("drip_ittt")

    assert number == "DI-42"
    sent = json.loads(save_route.calls.last.request.content)
    assert sent["data"]["orderSeq"] == 42
    assert sent["data"]["invoiceSeq"] == 10  # other counters preserved


@respx.mock
async def test_next_order_number_starts_at_one_for_new_brand():
    respx.get(URL, params={"action": "list", "entity": "counters"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    respx.post(URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    assert await SheetsClient(URL).next_order_number("NOVUS") == "NV-1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_sheets_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sheets_client'`

- [ ] **Step 3: Write `sheets_client.py`**

Create `server/sheets_client.py`:

```python
"""Wrapper around the Google Apps Script Web App that DripIT already uses
as its Sheets sync backend. The Apps Script's `save` action REPLACES a row
by id rather than merging (see doPost in the generated script) — so every
partial update here does a read-merge-write instead of sending a bare
partial dict.
"""
from __future__ import annotations

import json

import httpx


class SheetsError(RuntimeError):
    """Raised when a Sheets request fails or the Apps Script reports ok=false."""


class SheetsClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None):
        self._url = base_url
        self._client = client or httpx.AsyncClient(timeout=30.0)

    async def list_rows(self, entity: str) -> list[dict]:
        response = await self._client.get(self._url, params={"action": "list", "entity": entity})
        body = self._parse(response)
        return body.get("data", [])

    async def save_row(self, entity: str, data: dict) -> None:
        # Sent as text/plain to avoid a CORS preflight, matching the app's
        # own sync mechanism — Apps Script reads e.postData.contents either way.
        response = await self._client.post(
            self._url,
            content=json.dumps({"action": "save", "entity": entity, "data": data}),
            headers={"Content-Type": "text/plain;charset=utf-8"},
        )
        self._parse(response)

    def _parse(self, response: httpx.Response) -> dict:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise SheetsError(f"Sheets request failed: {response.status_code}") from exc
        body = response.json()
        if not body.get("ok"):
            raise SheetsError(f"Sheets error: {body.get('error')}")
        return body

    async def get_pending_deal(self, deal_id: str) -> dict | None:
        for row in await self.list_rows("pendingDeals"):
            if str(row.get("id")) == str(deal_id):
                return row
        return None

    async def create_pending_deal(self, data: dict) -> None:
        await self.save_row("pendingDeals", data)

    async def update_pending_deal(self, deal_id: str, **changes) -> dict:
        current = await self.get_pending_deal(deal_id)
        if current is None:
            raise SheetsError(f"PendingDeal {deal_id} not found")
        merged = {**current, **changes}
        await self.save_row("pendingDeals", merged)
        return merged

    async def append_order(self, order: dict) -> None:
        await self.save_row("orders", order)

    async def next_order_number(self, brand: str) -> str:
        rows = await self.list_rows("counters")
        row = next((r for r in rows if str(r.get("id")) == brand), None)
        current_seq = int(row["orderSeq"]) if row and row.get("orderSeq") else 0
        next_seq = current_seq + 1
        await self.save_row("counters", {**(row or {"id": brand}), "orderSeq": next_seq})
        prefix = "NV" if brand == "NOVUS" else "DI"
        return f"{prefix}-{next_seq}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_sheets_client.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/sheets_client.py server/tests/test_sheets_client.py
git commit -m "server: add Sheets client with read-merge-write pending deal updates"
```

---

### Task 6: `image_engine.py` — Pillow banner renderer

**Files:**
- Create: `server/image_engine.py`
- Create: `server/tests/test_image_engine.py`

**Interfaces:**
- Consumes: `httpx` directly.
- Produces: `image_engine.CANVAS_SIZE` (`(1080, 1080)`), `image_engine.ImageRenderError` (exception), `image_engine.render_banner(product_title: str, image_url: str, price_text: str, offer_text: str = "LIMITED TIME PRE-ORDER", client: httpx.AsyncClient | None = None) -> bytes` (async, returns PNG bytes; raises `ImageRenderError` if the product image can't be downloaded or decoded).

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_image_engine.py`:

```python
import io

import httpx
import pytest
import respx
from PIL import Image

from image_engine import CANVAS_SIZE, ImageRenderError, render_banner


def _sample_png_bytes() -> bytes:
    img = Image.new("RGBA", (200, 150), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@respx.mock
async def test_render_banner_returns_canvas_sized_png():
    respx.get("https://cdn.example.com/shoe.jpg").mock(
        return_value=httpx.Response(200, content=_sample_png_bytes())
    )

    result = await render_banner("Air Max 90", "https://cdn.example.com/shoe.jpg", "7600")

    out = Image.open(io.BytesIO(result))
    assert out.format == "PNG"
    assert out.size == CANVAS_SIZE


@respx.mock
async def test_render_banner_raises_on_download_failure():
    respx.get("https://cdn.example.com/missing.jpg").mock(return_value=httpx.Response(404))

    with pytest.raises(ImageRenderError):
        await render_banner("Air Max 90", "https://cdn.example.com/missing.jpg", "7600")


@respx.mock
async def test_render_banner_raises_on_unparseable_image():
    respx.get("https://cdn.example.com/notanimage.jpg").mock(
        return_value=httpx.Response(200, content=b"not an image")
    )

    with pytest.raises(ImageRenderError):
        await render_banner("Air Max 90", "https://cdn.example.com/notanimage.jpg", "7600")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_image_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'image_engine'`

- [ ] **Step 3: Write `image_engine.py`**

Create `server/image_engine.py`:

```python
"""Renders the 1080x1080 promo banner with Pillow.

Uses Pillow's own bundled scalable font (`ImageFont.load_default(size=N)`,
available since Pillow 10.1) instead of relying on `arial.ttf`, which does
not exist on Render's Linux containers and would otherwise silently fall
back to a tiny, illegible bitmap font. No external font file to manage.
"""
from __future__ import annotations

import io

import httpx
from PIL import Image, ImageDraw, ImageFont

CANVAS_SIZE = (1080, 1080)
_PRODUCT_MAX_SIZE = (750, 550)
_PRODUCT_TOP = 220


class ImageRenderError(RuntimeError):
    """Raised when the product image can't be downloaded or decoded."""


async def render_banner(
    product_title: str,
    image_url: str,
    price_text: str,
    offer_text: str = "LIMITED TIME PRE-ORDER",
    client: httpx.AsyncClient | None = None,
) -> bytes:
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=15.0)
    try:
        try:
            response = await client.get(image_url)
            response.raise_for_status()
            product_img = Image.open(io.BytesIO(response.content)).convert("RGBA")
        except (httpx.HTTPError, OSError) as exc:
            raise ImageRenderError(f"Could not load product image: {exc}") from exc
    finally:
        if owns_client:
            await client.aclose()

    canvas = Image.new("RGB", CANVAS_SIZE, color=(255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    product_img.thumbnail(_PRODUCT_MAX_SIZE, Image.Resampling.LANCZOS)
    p_width, p_height = product_img.size
    p_x = (CANVAS_SIZE[0] - p_width) // 2
    p_y = _PRODUCT_TOP + (_PRODUCT_MAX_SIZE[1] - p_height) // 2
    canvas.paste(product_img, (p_x, p_y), mask=product_img)

    font_title = ImageFont.load_default(size=44)
    font_price = ImageFont.load_default(size=62)
    font_sub = ImageFont.load_default(size=26)

    center_x = CANVAS_SIZE[0] // 2
    draw.text((center_x, 100), product_title.upper(), fill="#1A2E26", font=font_title, anchor="mm")
    draw.text((center_x, 830), f"PRICE - {price_text} TAKA", fill="#1A2E26", font=font_price, anchor="mm")
    draw.text((center_x, 910), offer_text.upper(), fill="#D32F2F", font=font_sub, anchor="mm")

    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_image_engine.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/image_engine.py server/tests/test_image_engine.py
git commit -m "server: add Pillow banner renderer using Pillow's bundled scalable font"
```

---

### Task 7: `main.py` — app factory, health check, scraper-deal webhook

**Files:**
- Create: `server/main.py`
- Create: `server/tests/conftest.py`
- Create: `server/tests/test_main_scraper_webhook.py`

**Interfaces:**
- Consumes: `config.Settings`, `config.load_settings`; `bots.TelegramBot`, `bots.escape_markdown`; `sheets_client.SheetsClient`; `models.ScraperDeal`.
- Produces: `main.create_app(settings: Settings) -> FastAPI`; module-level `main.app` (built from `load_settings()`); routes `GET /healthz`, `POST /webhook/scraper-deal`.

- [ ] **Step 1: Write the test env fixture**

Create `server/tests/conftest.py` (module-level code, not a fixture function, so these env vars exist before any test module does `import main`):

```python
import os

os.environ.setdefault("REVIEWER_BOT_TOKEN", "test-reviewer-token")
os.environ.setdefault("PUBLISHER_BOT_TOKEN", "test-publisher-token")
os.environ.setdefault("TELEGRAM_CHAT_ID", "-1001234567890")
os.environ.setdefault("TELEGRAM_ALLOWED_USER_IDS", "111,222")
os.environ.setdefault("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("APIFY_WEBHOOK_SECRET", "test-apify-secret")
os.environ.setdefault("SHEETS_URL", "https://script.google.com/macros/s/test/exec")
os.environ.setdefault("DEAL_BRAND", "drip_ittt")
```

- [ ] **Step 2: Write the failing test**

Create `server/tests/test_main_scraper_webhook.py`:

```python
import json

import httpx
import respx
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
SHEETS_URL = "https://script.google.com/macros/s/test/exec"
VALID_DEAL = {
    "deal_id": "d1", "title": "Air Max 90", "myr_price": 350, "sizes": "40,41",
    "image_url": "https://x/i.jpg",
}


@respx.mock
def test_healthz_returns_ok():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


@respx.mock
def test_scraper_deal_rejects_missing_secret():
    resp = client.post("/webhook/scraper-deal", json=VALID_DEAL)
    assert resp.status_code == 403


@respx.mock
def test_scraper_deal_rejects_wrong_secret():
    resp = client.post(
        "/webhook/scraper-deal", json=VALID_DEAL, headers={"X-Apify-Secret": "wrong"}
    )
    assert resp.status_code == 403


@respx.mock
def test_scraper_deal_creates_pending_row_and_sends_review_card():
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    send_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/scraper-deal", json=VALID_DEAL, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "deal_id": "d1"}

    assert save_route.called
    saved = json.loads(save_route.calls.last.request.content)
    assert saved["entity"] == "pendingDeals"
    assert saved["data"]["id"] == "d1"
    assert saved["data"]["myr_price"] == 350.0
    assert saved["data"]["status"] == "awaiting_review"

    assert send_route.called
    sent = json.loads(send_route.calls.last.request.content)
    buttons = sent["reply_markup"]["inline_keyboard"][0]
    assert [b["callback_data"] for b in buttons] == ["reject:d1", "postonly:d1", "createorder:d1"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_main_scraper_webhook.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'main'`

- [ ] **Step 4: Write `main.py` (app factory + healthz + scraper-deal route)**

Create `server/main.py`:

```python
"""FastAPI app for the sneaker deal pipeline. Routes are attached inside
create_app() so tests can build an app from an explicit Settings instance
instead of touching real environment variables (only the module-level
`app = create_app(load_settings())` at the bottom reads the real env).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException

import bots
import sheets_client as sheets_mod
from config import Settings, load_settings
from models import ScraperDeal

logger = logging.getLogger("sneaker_pipeline")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Sneaker Deal Pipeline")

    reviewer_bot = bots.TelegramBot(settings.reviewer_bot_token)
    publisher_bot = bots.TelegramBot(settings.publisher_bot_token)
    sheets = sheets_mod.SheetsClient(settings.sheets_url)

    # Tasks 8 and 9 add more routes/helpers inside this same create_app
    # function, closing over these same reviewer_bot/publisher_bot/sheets/
    # settings variables directly — no app.state indirection needed.

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    @app.post("/webhook/scraper-deal")
    async def receive_scraper_deal(deal: ScraperDeal, x_apify_secret: str = Header(default="")):
        if x_apify_secret != settings.apify_webhook_secret:
            raise HTTPException(status_code=403, detail="Invalid secret")

        await sheets.create_pending_deal({
            "id": deal.deal_id,
            "title": deal.title,
            "myr_price": deal.myr_price,
            "sizes": deal.sizes,
            "image_url": deal.image_url,
            "status": "awaiting_review",
            "pending_action": "",
            "created_at": _now_iso(),
        })

        caption = (
            "\U0001f6a8 *NEW DEAL DETECTED*\n\n"
            f"\U0001f45f *Item:* {bots.escape_markdown(deal.title)}\n"
            f"\U0001f3f7️ *MYR Price:* {deal.myr_price}\n"
            f"\U0001f45f *Sizes:* {bots.escape_markdown(deal.sizes)}\n\n"
            "Select action:"
        )
        await reviewer_bot.send_review_card(settings.telegram_chat_id, deal.image_url, caption, deal.deal_id)
        return {"status": "ok", "deal_id": deal.deal_id}

    return app


app = create_app(load_settings())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_main_scraper_webhook.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add server/main.py server/tests/conftest.py server/tests/test_main_scraper_webhook.py
git commit -m "server: add app factory, healthz, and scraper-deal webhook"
```

---

### Task 8: `main.py` — Telegram callback_query handling (Reject / Post Only / Create Order)

**Files:**
- Modify: `server/main.py`
- Create: `server/tests/test_main_telegram_callback.py`

**Interfaces:**
- Consumes: `sheets_client.SheetsError`; `models.PENDING_ACTIONS`.
- Produces: route `POST /webhook/telegram-reviewer` (callback_query branch only in this task); helper `main._is_allowed(settings, chat_id, user_id) -> bool`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_main_telegram_callback.py`:

```python
import json

import httpx
import respx
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
SHEETS_URL = "https://script.google.com/macros/s/test/exec"
SECRET_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}


def _callback_payload(action: str, deal_id: str, user_id: int = 111, chat_id: int = -1001234567890) -> dict:
    return {
        "callback_query": {
            "id": "cb1",
            "data": f"{action}:{deal_id}",
            "from": {"id": user_id},
            "message": {"chat": {"id": chat_id}, "message_id": 55},
        }
    }


@respx.mock
def test_telegram_webhook_rejects_wrong_secret():
    resp = client.post(
        "/webhook/telegram-reviewer", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"}
    )
    assert resp.status_code == 403


@respx.mock
def test_reject_callback_deletes_message_and_marks_rejected():
    respx.get(SHEETS_URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(
            200, json={"ok": True, "data": [{"id": "d1", "title": "Air Max", "status": "awaiting_review"}]}
        )
    )
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    delete_route = respx.post("https://api.telegram.org/bottest-reviewer-token/deleteMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": True})
    )
    respx.post("https://api.telegram.org/bottest-reviewer-token/answerCallbackQuery").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": True})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_callback_payload("reject", "d1")
    )

    assert resp.status_code == 200
    assert delete_route.called
    saved = json.loads(save_route.calls.last.request.content)
    assert saved["data"]["status"] == "rejected"
    assert saved["data"]["title"] == "Air Max"  # untouched field preserved


@respx.mock
def test_createorder_callback_prompts_for_price():
    respx.get(SHEETS_URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(
            200, json={"ok": True, "data": [{"id": "d1", "title": "Air Max", "status": "awaiting_review"}]}
        )
    )
    respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    respx.post("https://api.telegram.org/bottest-reviewer-token/answerCallbackQuery").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": True})
    )
    prompt_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_callback_payload("createorder", "d1")
    )

    assert resp.status_code == 200
    sent = json.loads(prompt_route.calls.last.request.content)
    assert "[REF:d1]" in sent["text"]
    assert sent["reply_markup"] == {"force_reply": True}


@respx.mock
def test_callback_from_disallowed_chat_is_ignored():
    answer_route = respx.post("https://api.telegram.org/bottest-reviewer-token/answerCallbackQuery").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": True})
    )

    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json=_callback_payload("reject", "d1", user_id=999, chat_id=-1),
    )

    assert resp.status_code == 200
    sent = json.loads(answer_route.calls.last.request.content)
    assert sent["text"] == "Not authorized."


@respx.mock
def test_publish_callback_for_missing_deal_notifies_reviewer():
    respx.get(SHEETS_URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    respx.post("https://api.telegram.org/bottest-reviewer-token/answerCallbackQuery").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": True})
    )
    msg_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_callback_payload("postonly", "missing")
    )

    assert resp.status_code == 200
    sent = json.loads(msg_route.calls.last.request.content)
    assert "not found" in sent["text"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_main_telegram_callback.py -v`
Expected: FAIL — `404 Not Found` on `/webhook/telegram-reviewer` (route doesn't exist yet), causing the first assertion to fail.

- [ ] **Step 3: Extend `main.py` with the callback_query route**

In `server/main.py`, add these imports:

```python
from fastapi import Request
from sheets_client import SheetsError
from models import PENDING_ACTIONS
```

Add this module-level helper function (outside `create_app`, since it only needs `settings`):

```python
def _is_allowed(settings: Settings, chat_id: int, user_id: int | None) -> bool:
    if chat_id != settings.telegram_chat_id:
        return False
    if user_id is not None and user_id not in settings.telegram_allowed_user_ids:
        return False
    return True
```

Inside `create_app`, before the `return app` line, add:

```python
    @app.post("/webhook/telegram-reviewer")
    async def handle_telegram_update(
        request: Request, x_telegram_bot_api_secret_token: str = Header(default="")
    ):
        if x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
            raise HTTPException(status_code=403, detail="Invalid secret")

        data = await request.json()

        if "callback_query" in data:
            await _handle_callback(data["callback_query"], settings, reviewer_bot, sheets)
            return {"status": "ok"}

        return {"status": "ignored"}
```

And add this module-level function (outside `create_app`, alongside `_is_allowed`):

```python
async def _handle_callback(
    callback: dict, settings: Settings, reviewer_bot: bots.TelegramBot, sheets: sheets_mod.SheetsClient
) -> None:
    callback_id = callback["id"]
    chat_id = callback["message"]["chat"]["id"]
    message_id = callback["message"]["message_id"]
    user_id = callback.get("from", {}).get("id")
    action, deal_id = callback["data"].split(":", 1)

    if not _is_allowed(settings, chat_id, user_id):
        await reviewer_bot.answer_callback(callback_id, "Not authorized.")
        return

    if action == "reject":
        await reviewer_bot.delete_message(chat_id, message_id)
        await reviewer_bot.answer_callback(callback_id, "Deal rejected.")
        try:
            await sheets.update_pending_deal(deal_id, status="rejected")
        except SheetsError:
            logger.warning("Reject callback for unknown deal %s", deal_id)
        return

    if action in PENDING_ACTIONS:
        await reviewer_bot.answer_callback(callback_id, "Enter BDT price")
        try:
            await sheets.update_pending_deal(deal_id, status="awaiting_price", pending_action=action)
        except SheetsError:
            await reviewer_bot.send_message(chat_id, f"⚠️ Deal {deal_id} not found (may have expired).")
            return
        await reviewer_bot.send_force_reply(
            chat_id, f"Enter the final BDT price for this item (numbers only).\n[REF:{deal_id}]"
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_main_telegram_callback.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `pytest -v`
Expected: all previous tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add server/main.py server/tests/test_main_telegram_callback.py
git commit -m "server: handle Reject/Post Only/Create Order callback buttons"
```

---

### Task 9: `main.py` — price-reply handling and the publish orchestration

**Files:**
- Modify: `server/main.py`
- Create: `server/tests/test_main_price_reply.py`

**Interfaces:**
- Consumes: `image_engine.render_banner`, `image_engine.ImageRenderError`; everything from Tasks 3–8.
- Produces: the `message` branch of `POST /webhook/telegram-reviewer`; module-level `main._process_publish(...)`, `main._build_caption(...)`, `main._build_order_row(...)` (all pure/testable via the route's observable side effects, per the tests below).

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_main_price_reply.py`:

```python
import io
import json

import httpx
import respx
from fastapi.testclient import TestClient
from PIL import Image

from main import app

client = TestClient(app)
SHEETS_URL = "https://script.google.com/macros/s/test/exec"
SECRET_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}


def _sample_png_bytes() -> bytes:
    img = Image.new("RGBA", (200, 150), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _price_reply_payload(deal_id: str, price: str, chat_id: int = -1001234567890, user_id: int = 111) -> dict:
    return {
        "message": {
            "text": price,
            "chat": {"id": chat_id},
            "from": {"id": user_id},
            "reply_to_message": {"text": f"Enter price\n[REF:{deal_id}]"},
        }
    }


def _mock_pending_deal(deal_id: str, **overrides) -> None:
    row = {
        "id": deal_id, "title": "Air Max", "sizes": "40", "image_url": "https://x/i.jpg",
        "myr_price": 350, "status": "awaiting_price", "pending_action": "createorder",
        **overrides,
    }
    respx.get(SHEETS_URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": [row]})
    )


@respx.mock
def test_price_reply_publishes_and_creates_order_for_createorder_action():
    _mock_pending_deal("d1", pending_action="createorder")
    respx.get("https://x/i.jpg").mock(return_value=httpx.Response(200, content=_sample_png_bytes()))
    respx.get(SHEETS_URL, params={"action": "list", "entity": "counters"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    publish_route = respx.post("https://api.telegram.org/bottest-publisher-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_price_reply_payload("d1", "7600")
    )

    assert resp.status_code == 200
    assert publish_route.called

    saved_calls = [json.loads(c.request.content) for c in save_route.calls]
    order_write = next(c for c in saved_calls if c["entity"] == "orders")
    assert order_write["data"]["company"] == "drip_ittt"
    assert order_write["data"]["orderNumber"] == "DI-1"
    assert order_write["data"]["productName"] == "Air Max"
    assert order_write["data"]["costPriceRM"] == 350

    final_status = [c["data"]["status"] for c in saved_calls if c["entity"] == "pendingDeals"][-1]
    assert final_status == "published"


@respx.mock
def test_price_reply_post_only_does_not_create_order():
    _mock_pending_deal("d2", pending_action="postonly")
    respx.get("https://x/i.jpg").mock(return_value=httpx.Response(200, content=_sample_png_bytes()))
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    respx.post("https://api.telegram.org/bottest-publisher-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_price_reply_payload("d2", "6500")
    )

    assert resp.status_code == 200
    saved_calls = [json.loads(c.request.content) for c in save_route.calls]
    assert not any(c["entity"] == "orders" for c in saved_calls)


@respx.mock
def test_duplicate_price_reply_after_already_published_is_ignored():
    _mock_pending_deal("d3", status="published")
    reviewer_msg_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    publish_route = respx.post("https://api.telegram.org/bottest-publisher-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_price_reply_payload("d3", "6000")
    )

    assert resp.status_code == 200
    assert not publish_route.called
    sent = json.loads(reviewer_msg_route.calls.last.request.content)
    assert "already processed" in sent["text"].lower()


@respx.mock
def test_publish_failure_reverts_status_and_notifies_reviewer():
    _mock_pending_deal("d4", pending_action="postonly")
    respx.get("https://x/i.jpg").mock(return_value=httpx.Response(500))
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    error_msg_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_price_reply_payload("d4", "5000")
    )

    assert resp.status_code == 200
    saved_calls = [json.loads(c.request.content) for c in save_route.calls]
    statuses = [c["data"]["status"] for c in saved_calls if c["entity"] == "pendingDeals"]
    assert statuses[-1] == "awaiting_price"  # reverted after the earlier "processing" claim
    last_msg = json.loads(error_msg_route.calls.last.request.content)
    assert "Failed to publish" in last_msg["text"]


@respx.mock
def test_non_reply_message_is_ignored():
    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json={"message": {"text": "hello", "chat": {"id": -1001234567890}, "from": {"id": 111}}},
    )
    assert resp.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_main_price_reply.py -v`
Expected: FAIL — price replies currently fall through to `{"status": "ignored"}` and none of the mocked routes are called, so e.g. `test_price_reply_publishes_and_creates_order_for_createorder_action` fails on `assert publish_route.called`.

- [ ] **Step 3: Extend `main.py` with message handling and the publish orchestration**

Add this import to `server/main.py`:

```python
import re
from fastapi import BackgroundTasks
from image_engine import ImageRenderError, render_banner
```

In `create_app`, change the `handle_telegram_update` route to also dispatch messages:

```python
    @app.post("/webhook/telegram-reviewer")
    async def handle_telegram_update(
        request: Request,
        background_tasks: BackgroundTasks,
        x_telegram_bot_api_secret_token: str = Header(default=""),
    ):
        if x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
            raise HTTPException(status_code=403, detail="Invalid secret")

        data = await request.json()

        if "callback_query" in data:
            await _handle_callback(data["callback_query"], settings, reviewer_bot, sheets)
            return {"status": "ok"}

        if "message" in data:
            await _handle_message(data["message"], settings, reviewer_bot, publisher_bot, sheets, background_tasks)
            return {"status": "ok"}

        return {"status": "ignored"}
```

Add these module-level functions (outside `create_app`, alongside `_is_allowed` and `_handle_callback`):

```python
_REF_PATTERN = re.compile(r"\[REF:([^\]]+)\]")


async def _handle_message(
    msg: dict,
    settings: Settings,
    reviewer_bot: bots.TelegramBot,
    publisher_bot: bots.TelegramBot,
    sheets: sheets_mod.SheetsClient,
    background_tasks: BackgroundTasks,
) -> None:
    chat_id = msg["chat"]["id"]
    user_id = msg.get("from", {}).get("id")
    if not _is_allowed(settings, chat_id, user_id):
        return

    text = (msg.get("text") or "").strip()
    reply_to_text = msg.get("reply_to_message", {}).get("text", "")
    match = _REF_PATTERN.search(reply_to_text)
    if not match or not text.isdigit():
        return

    deal_id = match.group(1)
    try:
        deal = await sheets.get_pending_deal(deal_id)
    except SheetsError:
        deal = None

    if deal is None or deal.get("status") != "awaiting_price":
        await reviewer_bot.send_message(chat_id, "⚠️ This deal was already processed or has expired.")
        return

    # Claim the row immediately, before any slow work, so a duplicate or
    # retried reply can't double-publish.
    deal = await sheets.update_pending_deal(deal_id, status="processing")
    await reviewer_bot.send_message(chat_id, f"⏳ Rendering banner for {deal['title']} at {text} BDT...")
    background_tasks.add_task(_process_publish, deal, text, chat_id, settings, reviewer_bot, publisher_bot, sheets)


async def _process_publish(
    deal: dict,
    bdt_price: str,
    reviewer_chat_id: int,
    settings: Settings,
    reviewer_bot: bots.TelegramBot,
    publisher_bot: bots.TelegramBot,
    sheets: sheets_mod.SheetsClient,
) -> None:
    deal_id = deal["id"]
    try:
        image_bytes = await render_banner(
            product_title=deal["title"], image_url=deal["image_url"], price_text=bdt_price
        )
        caption = _build_caption(deal, bdt_price)
        await publisher_bot.publish_photo(settings.telegram_chat_id, image_bytes, caption)

        if deal.get("pending_action") == "createorder":
            order_number = await sheets.next_order_number(settings.deal_brand)
            await sheets.append_order(_build_order_row(deal, bdt_price, order_number, settings.deal_brand))

        await sheets.update_pending_deal(deal_id, status="published")
    except (ImageRenderError, bots.TelegramError, SheetsError) as exc:
        logger.exception("Failed to publish deal %s", deal_id)
        try:
            await sheets.update_pending_deal(deal_id, status="awaiting_price")
        except SheetsError:
            logger.exception("Failed to revert status for deal %s", deal_id)
        await reviewer_bot.send_message(
            reviewer_chat_id, f"⚠️ Failed to publish: {exc}. Reply again to retry."
        )


def _build_caption(deal: dict, bdt_price: str) -> str:
    title = bots.escape_markdown(deal["title"])
    sizes = bots.escape_markdown(deal["sizes"])
    return (
        "\U0001f4cc *FINAL POST*\n\n"
        f"[PRE-ORDER MALAYSIA] {title}\n"
        "All the way from Malaysia to Bangladesh\n\n"
        f"\U0001f4b0 *Offer Price:* {bdt_price} BDT\n"
        f"\U0001f45f *Available Sizes:* {sizes}\n"
        "\U0001f4e6 *Delivery:* 3-4 weeks, if lucky could be 2 weeks.\n"
        "\U0001f4cc We only deal with Authentic products.\n\n"
        "Inbox us to order | 30% Advance Required"
    )


def _build_order_row(deal: dict, bdt_price: str, order_number: str, brand: str) -> dict:
    myr_price = float(deal["myr_price"])
    bdt = float(bdt_price)
    return {
        "id": f"deal-{deal['id']}",
        "company": brand,
        "orderNumber": order_number,
        "customerName": "",
        "customerPhone": "",
        "customerFb": "",
        "productName": deal["title"],
        "productDescription": f"Sizes: {deal['sizes']}",
        "costPriceRM": myr_price,
        "conversionRate": "",
        "multiplier": round(bdt / myr_price, 2) if myr_price else "",
        "status": "pending",
        "orderDate": _now_iso(),
        "advancePaid": False,
        "deliveryDate": "",
        "notes": "Created via Telegram deal pipeline — needs customer name/phone/payment",
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_main_price_reply.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `pytest -v`
Expected: all tests across every task PASS.

- [ ] **Step 6: Commit**

```bash
git add server/main.py server/tests/test_main_price_reply.py
git commit -m "server: handle price replies, publish orchestration, and order creation"
```

---

### Task 10: Deployment docs and manual rollout checklist

**Files:**
- Create: `server/README.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks — this is the operator-facing rollout guide referenced by spec Section 10.

- [ ] **Step 1: Write `server/README.md`**

Create `server/README.md`:

```markdown
# Sneaker Deal Pipeline — Backend

FastAPI service that takes a scraped deal from Apify through a Telegram
review step and publishes it, optionally creating a real Pending order in
DripIT. See `docs/superpowers/specs/2026-09-14-sneaker-deal-pipeline-design.md`
for the full design.

## Environment variables (set in Render's dashboard)

| Variable | Example | Notes |
|---|---|---|
| `REVIEWER_BOT_TOKEN` | `123456:AAE...` | Token for the internal review bot |
| `PUBLISHER_BOT_TOKEN` | `789012:AAF...` | Token for the bot that posts publicly |
| `TELEGRAM_CHAT_ID` | `-1001234567890` | The review chat's id |
| `TELEGRAM_ALLOWED_USER_IDS` | `111111111,222222222` | Comma-separated Telegram user ids allowed to act |
| `TELEGRAM_WEBHOOK_SECRET` | a random string you generate | Passed to Telegram's `setWebhook` as `secret_token` |
| `APIFY_WEBHOOK_SECRET` | a random string you generate | Checked against the `X-Apify-Secret` header |
| `SHEETS_URL` | the Apps Script Web App URL | Same URL DripIT's Export & Sync tab uses |
| `DEAL_BRAND` | `drip_ittt` or `NOVUS` | Brand every scraped deal's order is attributed to |

## First-time setup

1. **Redeploy the Apps Script.** In DripIT, open the "Export & Sync" tab →
   "Show Apps Script Code" → copy it → paste into your existing
   script.google.com project (replacing the old code) → Deploy → New
   deployment (or "Manage deployments" → edit → new version). This adds
   the `pendingDeals` tab and the `orders.company` column the backend
   needs.

2. **Deploy to Render.**
   - New Web Service → connect this repo.
   - Root directory: `server`
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Instance type: Free
   - Add every environment variable from the table above.
   - Deploy. Note the resulting URL, e.g. `https://your-app.onrender.com`.

3. **Register the Telegram webhook** (generates the secret check the
   backend verifies):

   ```bash
   curl -X POST "https://api.telegram.org/bot<REVIEWER_BOT_TOKEN>/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{
              "url": "https://your-app.onrender.com/webhook/telegram-reviewer",
              "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
            }'
   ```

4. **Point the Apify actor's webhook integration** at
   `https://your-app.onrender.com/webhook/scraper-deal`, with a custom
   header `X-Apify-Secret: <APIFY_WEBHOOK_SECRET>` on the outgoing request
   (Apify's webhook integration UI lets you add custom headers).

## Manual smoke test (run once after every deploy)

1. Send a test payload to `/webhook/scraper-deal` (with the correct
   `X-Apify-Secret` header) and confirm the review card appears in the
   Telegram chat with all three buttons.
2. Tap **Reject** — confirm the message is deleted and the `pendingDeals`
   row's `status` becomes `rejected`.
3. Send another test deal, tap **Post Only**, reply with a price — confirm
   the banner is posted to the public chat/channel and **no** row is added
   to the `orders` tab.
4. Send a third test deal, tap **Create Order**, reply with a price —
   confirm the banner is posted **and** a new Pending order appears on the
   DripIT dashboard under the configured brand.
5. Send a deal with a title containing `_`, `*`, or `[` through Create
   Order — confirm it completes without a Telegram 400 error (Markdown
   escaping holds).
6. Restart the Render service mid-review (Render dashboard → Manual
   Deploy, or just wait for a free-tier idle sleep) with a deal sitting at
   `awaiting_price` — confirm replying with a price afterwards still
   completes normally (state survived because it lives in the Sheet, not
   in memory).

## Known limitation

DripIT's own Sheets sync pushes a full `replaceAll` of every order
whenever anything is edited in the app. If a DripIT browser tab has been
open since before this backend appends a new order, editing anything else
in that tab can overwrite the Sheet with that tab's stale local data,
silently dropping the backend-created order. Refresh the DripIT tab before
editing orders around when deals are expected to land. This is the same
last-write-wins behavior that already exists between two devices editing
concurrently — not something this pipeline introduces.
```

- [ ] **Step 2: Verify the whole suite is green end to end**

Run (from `server/`): `pip install -r requirements-dev.txt && pytest -v`
Expected: every test across all 9 code tasks PASSES.

- [ ] **Step 3: Commit**

```bash
git add server/README.md
git commit -m "server: add deployment guide and manual rollout checklist"
```

---

## Self-Review Notes

- **Spec coverage:** Section 4 (architecture/repo layout) → Task 1, 7. Section 5 (data flow) → Tasks 7–9. Section 6 (data model / Apps Script changes) → Task 2, and consumed by Task 5/9. Section 7 (security: webhook secrets, chat/user allowlist) → Tasks 7, 8. Section 8 (reliability gaps table) → Task 5 (persistence + idempotency), Task 6 (async fetch + font), Task 9 (idempotency claim, error revert). Section 9 (error handling: try/except, logging, `/healthz`) → Tasks 7, 9. Section 10 (rollout/manual testing) → Task 10.
- **Type/interface consistency checked:** `SheetsClient.update_pending_deal` (Task 5) is the only mutator `main.py` (Tasks 8–9) uses for `pendingDeals`, always read-merge-write. `PENDING_ACTIONS` (Task 3) is reused verbatim in Task 8's callback dispatch. `render_banner`'s signature (Task 6) matches its call in `_process_publish` (Task 9) exactly. `_build_order_row`'s field names match `HEADERS.orders` as amended in Task 2.
- **No placeholders:** every step above contains complete, runnable code — no "add error handling" or "similar to Task N" references.
