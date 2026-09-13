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
