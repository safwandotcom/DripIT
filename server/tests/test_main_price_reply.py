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
    respx.get(SHEETS_URL, params={"action": "list", "entity": "orders"}).mock(
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
    # Legacy Markdown would parse a bare "[...]" as a link; the brackets must
    # go out escaped so they render literally in the published caption.
    assert b"\\[PRE-ORDER MALAYSIA\\]" in publish_route.calls.last.request.content

    saved_calls = [json.loads(c.request.content) for c in save_route.calls]
    order_write = next(c for c in saved_calls if c["entity"] == "orders")
    assert order_write["data"]["company"] == "drip_ittt"
    assert order_write["data"]["orderNumber"] == "DI-0001"
    assert order_write["data"]["productName"] == "Air Max"
    assert order_write["data"]["costPriceRM"] == 350

    final_status = [c["data"]["status"] for c in saved_calls if c["entity"] == "pendingDeals"][-1]
    assert final_status == "published"


@respx.mock
def test_price_reply_includes_promo_note_in_published_caption():
    _mock_pending_deal("d1b", pending_action="postonly", promo_note="Buy 3 at 20% Off Sitewide")
    respx.get("https://x/i.jpg").mock(return_value=httpx.Response(200, content=_sample_png_bytes()))
    respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    publish_route = respx.post("https://api.telegram.org/bottest-publisher-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_price_reply_payload("d1b", "6500")
    )

    assert resp.status_code == 200
    caption_bytes = publish_route.calls.last.request.content
    assert b"Buy 3 at 20" in caption_bytes and b"Off Sitewide" in caption_bytes
    assert b"Confirm this item actually qualifies" in caption_bytes


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
def test_order_creation_failure_after_publish_does_not_revert_or_duplicate():
    _mock_pending_deal("d5", pending_action="createorder")
    respx.get("https://x/i.jpg").mock(return_value=httpx.Response(200, content=_sample_png_bytes()))
    respx.get(SHEETS_URL, params={"action": "list", "entity": "orders"}).mock(
        return_value=httpx.Response(500)
    )
    save_route = respx.post(SHEETS_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    reviewer_msg_route = respx.post("https://api.telegram.org/bottest-reviewer-token/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )
    publish_route = respx.post("https://api.telegram.org/bottest-publisher-token/sendPhoto").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": {}})
    )

    resp = client.post(
        "/webhook/telegram-reviewer", headers=SECRET_HEADERS, json=_price_reply_payload("d5", "8000")
    )

    assert resp.status_code == 200
    assert publish_route.called  # the banner WAS posted publicly

    saved_calls = [json.loads(c.request.content) for c in save_route.calls]
    final_status = [c["data"]["status"] for c in saved_calls if c["entity"] == "pendingDeals"][-1]
    assert final_status == "published"  # never reverted -- would invite a duplicate re-publish
    assert not any(c["entity"] == "orders" for c in saved_calls)  # order was never created

    last_msg = json.loads(reviewer_msg_route.calls.last.request.content)
    assert "manually" in last_msg["text"].lower()
    assert "reply again to retry" not in last_msg["text"].lower()


@respx.mock
def test_non_reply_message_is_ignored():
    resp = client.post(
        "/webhook/telegram-reviewer",
        headers=SECRET_HEADERS,
        json={"message": {"text": "hello", "chat": {"id": -1001234567890}, "from": {"id": 111}}},
    )
    assert resp.status_code == 200
