import json

import httpx
import respx
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
SHEETS_URL = "https://script.google.com/macros/s/test/exec"
SECRET_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}
CHAT_ID = -1001234567890
USER_ID = 111


def _link_message_payload(text: str, reply_to: dict | None = None) -> dict:
    message = {"text": text, "chat": {"id": CHAT_ID}, "from": {"id": USER_ID}}
    if reply_to is not None:
        message["reply_to_message"] = reply_to
    return {"message": message}


def _og_html(title="Air Max 90", image="https://cdn.example.com/shoe.jpg", price="149.00") -> bytes:
    return (
        "<html><head>"
        f'<meta property="og:title" content="{title}">'
        f'<meta property="og:image" content="{image}">'
        f'<meta property="product:price:amount" content="{price}">'
        "</head></html>"
    ).encode()


@respx.mock
def test_pasted_link_creates_pending_deal_and_review_card():
    respx.get("https://shop.example.com/nike-air-max").mock(
        return_value=httpx.Response(200, content=_og_html(title="Nike Air Max 90"))
    )
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    ack_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    card_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json=_link_message_payload("https://shop.example.com/nike-air-max"),
    )

    assert resp.status_code == 200
    assert ack_route.called  # "Fetching that link..." ack sent immediately

    assert card_route.called
    sent = json.loads(card_route.calls.last.request.content)
    assert sent["photo"] == "https://cdn.example.com/shoe.jpg"
    assert "Nike Air Max 90" in sent["caption"]
    assert "*Brand:* Nike" in sent["caption"]
    assert "Auto-extracted from a pasted link" in sent["caption"]

    saved = json.loads(save_route.calls.last.request.content)
    assert saved["entity"] == "pendingDeals"
    assert saved["data"]["title"] == "Nike Air Max 90"
    assert saved["data"]["myr_price"] == 149.0
    assert saved["data"]["status"] == "awaiting_review"


@respx.mock
def test_pasted_link_that_fails_to_scrape_reports_error_and_creates_no_deal():
    respx.get("https://shop.example.com/blocked").mock(return_value=httpx.Response(403))
    # No Sheets-save or sendPhoto mock registered — respx raises if either is
    # called, proving no deal was created from the failed scrape.
    msg_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json=_link_message_payload("https://shop.example.com/blocked"),
    )

    assert resp.status_code == 200
    error_texts = [json.loads(c.request.content)["text"] for c in msg_route.calls]
    assert any("Couldn't build a deal" in t for t in error_texts)


@respx.mock
def test_pasted_link_missing_og_tags_reports_what_is_missing():
    respx.get("https://shop.example.com/bare").mock(
        return_value=httpx.Response(200, content=b"<html><body>nothing here</body></html>")
    )
    msg_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json=_link_message_payload("https://shop.example.com/bare"),
    )

    assert resp.status_code == 200
    error_texts = [json.loads(c.request.content)["text"] for c in msg_route.calls]
    assert any("Couldn't build a deal" in t for t in error_texts)


@respx.mock
def test_url_inside_a_reply_message_is_not_treated_as_a_link_paste():
    # A reply carrying a URL isn't the force-reply price prompt shape and
    # isn't a bare message either — it should be silently ignored, not
    # trigger a link scrape.
    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json=_link_message_payload(
            "https://shop.example.com/x", reply_to={"text": "some other message"}
        ),
    )
    assert resp.status_code == 200


@respx.mock
def test_non_url_plain_message_is_ignored():
    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json=_link_message_payload("just chatting, not a link"),
    )
    assert resp.status_code == 200
