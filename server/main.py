"""FastAPI app for the sneaker deal pipeline. Routes are attached inside
create_app() so tests can build an app from an explicit Settings instance
instead of touching real environment variables (only the module-level
`app = create_app(load_settings())` at the bottom reads the real env).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException, Request

import bots
import sheets_client as sheets_mod
from config import Settings, load_settings
from models import PENDING_ACTIONS, ScraperDeal
from sheets_client import SheetsError

logger = logging.getLogger("sneaker_pipeline")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_allowed(settings: Settings, chat_id: int, user_id: int | None) -> bool:
    if chat_id != settings.telegram_chat_id:
        return False
    if user_id is not None and user_id not in settings.telegram_allowed_user_ids:
        return False
    return True


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

    return app


app = create_app(load_settings())
