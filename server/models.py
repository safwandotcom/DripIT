"""Pydantic schemas and shared constants for the deal pipeline."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

PENDING_STATUSES = ("awaiting_review", "awaiting_price", "processing", "published", "rejected")
PENDING_ACTIONS = ("postonly", "createorder")


class ScraperDeal(BaseModel):
    deal_id: str = Field(max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    title: str
    myr_price: float
    sizes: str
    image_url: str
    promo_note: str | None = None
    """Optional site-wide promo/condition text captured at scrape time (e.g.
    "Buy 3 at 20% Off Sitewide"). Not a per-item guarantee — surfaced to the
    reviewer and the published caption as a disclaimer, not applied to price."""

    @field_validator("myr_price", mode="before")
    @classmethod
    def _parse_price(cls, value):
        if isinstance(value, str):
            value = value.upper().replace("RM", "").replace(",", "").strip()
        return float(value)
