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
