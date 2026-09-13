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
