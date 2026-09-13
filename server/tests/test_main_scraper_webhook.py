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


@respx.mock
def test_scraper_deal_returns_502_on_telegram_failure():
    respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(400, json={"ok": False, "description": "bad"})
    )

    resp = client.post(
        "/webhook/scraper-deal", json=VALID_DEAL, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 502
