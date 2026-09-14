import json

import httpx
import respx
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
SHEETS_URL = "https://script.google.com/macros/s/test/exec"
VALID_DEAL = {
    "deal_id": "d1", "title": "Air Max 90", "myr_price": 150, "sizes": "40,41",
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
    assert saved["data"]["myr_price"] == 150.0
    assert saved["data"]["status"] == "awaiting_review"

    assert send_route.called
    sent = json.loads(send_route.calls.last.request.content)
    buttons = sent["reply_markup"]["inline_keyboard"][0]
    assert [b["callback_data"] for b in buttons] == ["reject:d1", "postonly:d1", "createorder:d1"]


@respx.mock
def test_scraper_deal_includes_promo_note_in_review_card():
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    send_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    deal_with_promo = {**VALID_DEAL, "deal_id": "d2", "promo_note": "Buy 3 at 20% Off Sitewide"}
    resp = client.post(
        "/webhook/scraper-deal", json=deal_with_promo, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    saved = json.loads(save_route.calls.last.request.content)
    assert saved["data"]["promo_note"] == "Buy 3 at 20% Off Sitewide"

    sent = json.loads(send_route.calls.last.request.content)
    assert "Buy 3 at 20% Off Sitewide" in sent["caption"]
    assert "Confirm this item actually qualifies" in sent["caption"]


@respx.mock
def test_scraper_deal_without_promo_note_omits_disclaimer():
    respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    send_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/scraper-deal", json=VALID_DEAL, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    sent = json.loads(send_route.calls.last.request.content)
    assert "Site promo at scrape time" not in sent["caption"]


@respx.mock
def test_scraper_deal_includes_brand_line_when_title_names_a_known_brand():
    respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    send_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    nike_deal = {**VALID_DEAL, "deal_id": "d3", "title": "Nike Air Max 90"}
    resp = client.post(
        "/webhook/scraper-deal", json=nike_deal, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    sent = json.loads(send_route.calls.last.request.content)
    assert "*Brand:* Nike" in sent["caption"]


@respx.mock
def test_scraper_deal_omits_brand_line_when_title_names_no_known_brand():
    respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    send_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/scraper-deal", json=VALID_DEAL, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    sent = json.loads(send_route.calls.last.request.content)
    assert "*Brand:*" not in sent["caption"]


@respx.mock
def test_scraper_deal_filters_price_above_review_range():
    # No Sheets or Telegram mocks registered — respx raises if either is
    # actually called, which is exactly what proves the deal was dropped
    # before reaching that code.
    too_expensive = {**VALID_DEAL, "deal_id": "d4", "myr_price": 250}

    resp = client.post(
        "/webhook/scraper-deal", json=too_expensive, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "filtered", "deal_id": "d4", "reason": "price_out_of_range"}


@respx.mock
def test_scraper_deal_accepts_price_at_range_boundaries():
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    for deal_id, price in [("d5", 0), ("d6", 200)]:
        resp = client.post(
            "/webhook/scraper-deal",
            json={**VALID_DEAL, "deal_id": deal_id, "myr_price": price},
            headers={"X-Apify-Secret": "test-apify-secret"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok", "deal_id": deal_id}

    assert save_route.call_count == 2


@respx.mock
def test_scraper_deal_on_sale_bypasses_the_price_ceiling():
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    send_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    ua_sale_deal = {**VALID_DEAL, "deal_id": "d7", "title": "UA Pulse", "myr_price": 379.0, "on_sale": True}
    resp = client.post(
        "/webhook/scraper-deal", json=ua_sale_deal, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "deal_id": "d7"}

    saved = json.loads(save_route.calls.last.request.content)
    assert saved["data"]["on_sale"] is True

    sent = json.loads(send_route.calls.last.request.content)
    assert "Scraped from a sale page" in sent["caption"]


@respx.mock
def test_scraper_deal_not_on_sale_still_filtered_above_range():
    # Same price as the sale case above, but on_sale defaults to False —
    # still filtered, proving the bypass is tied to the flag, not the price.
    too_expensive_not_sale = {**VALID_DEAL, "deal_id": "d8", "myr_price": 379.0}

    resp = client.post(
        "/webhook/scraper-deal", json=too_expensive_not_sale, headers={"X-Apify-Secret": "test-apify-secret"}
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "filtered", "deal_id": "d8", "reason": "price_out_of_range"}


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
