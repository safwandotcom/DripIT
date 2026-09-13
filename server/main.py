"""FastAPI app for the sneaker deal pipeline. Routes are attached inside
create_app() so tests can build an app from an explicit Settings instance
instead of touching real environment variables (only the module-level
`app = create_app(load_settings())` at the bottom reads the real env).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request

import bots
import sheets_client as sheets_mod
from config import Settings, load_settings
from image_engine import render_banner
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
        await publisher_bot.publish_photo(settings.publish_chat_id, image_bytes, caption)
    except Exception as exc:
        logger.exception("Failed to render/publish banner for deal %s", deal_id)
        try:
            await sheets.update_pending_deal(deal_id, status="awaiting_price")
        except SheetsError:
            logger.exception("Failed to revert status for deal %s", deal_id)
        await reviewer_bot.send_message(
            reviewer_chat_id, f"⚠️ Failed to publish: {exc}. Reply again to retry."
        )
        return

    # The banner is now live publicly — never revert-and-retry past this point;
    # a retry would re-render and re-post it. Failures below are reported as a
    # partial-success message instead of an invitation to retry.
    try:
        await sheets.update_pending_deal(deal_id, status="published")
        if deal.get("pending_action") == "createorder":
            order_number = await sheets.next_order_number(settings.deal_brand)
            await sheets.append_order(_build_order_row(deal, bdt_price, order_number, settings.deal_brand))
    except Exception as exc:
        logger.exception("Banner published but bookkeeping failed for deal %s", deal_id)
        await reviewer_bot.send_message(
            reviewer_chat_id,
            f"⚠️ Banner published, but recording it in DripIT failed: {exc}. Please add this order manually.",
        )


def _build_caption(deal: dict, bdt_price: str) -> str:
    title = bots.escape_markdown(deal["title"])
    sizes = bots.escape_markdown(deal["sizes"])
    return (
        "\U0001f4cc *FINAL POST*\n\n"
        f"\\[PRE-ORDER MALAYSIA\\] {title}\n"
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

        try:
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
            await reviewer_bot.send_review_card(
                settings.telegram_chat_id, deal.image_url, caption, deal.deal_id
            )
        except (bots.TelegramError, SheetsError) as exc:
            logger.exception("Failed to process scraped deal %s", deal.deal_id)
            raise HTTPException(status_code=502, detail=f"Failed to process deal: {exc}") from exc

        return {"status": "ok", "deal_id": deal.deal_id}

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

    return app


app = create_app(load_settings())
