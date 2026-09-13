"""Pydantic schemas and shared constants for the deal pipeline."""
from __future__ import annotations

from pydantic import BaseModel, field_validator

PENDING_STATUSES = ("awaiting_review", "awaiting_price", "processing", "published", "rejected")
PENDING_ACTIONS = ("postonly", "createorder")


class ScraperDeal(BaseModel):
    deal_id: str
    title: str
    myr_price: float
    sizes: str
    image_url: str

    @field_validator("myr_price", mode="before")
    @classmethod
    def _parse_price(cls, value):
        if isinstance(value, str):
            value = value.upper().replace("RM", "").replace(",", "").strip()
        return float(value)
