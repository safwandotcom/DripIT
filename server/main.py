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
