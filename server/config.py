"""Environment configuration for the sneaker deal pipeline backend.

Settings is a plain dataclass so it can be constructed directly in tests
without touching real environment variables. `load_settings()` is the only
function that reads `os.environ`, and only when called explicitly — this
module has no import-time side effects.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

VALID_BRANDS = ("drip_ittt", "NOVUS")


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


@dataclass
class Settings:
    reviewer_bot_token: str
    publisher_bot_token: str
    telegram_chat_id: int
    telegram_allowed_user_ids: list[int]
    telegram_webhook_secret: str
    apify_webhook_secret: str
    sheets_url: str
    deal_brand: str

    def __post_init__(self) -> None:
        if self.deal_brand not in VALID_BRANDS:
            raise ConfigError(
                f"deal_brand must be one of {VALID_BRANDS}, got {self.deal_brand!r}"
            )


def _require(env: dict, name: str) -> str:
    value = (env.get(name) or "").strip()
    if not value:
        raise ConfigError(f"Missing required environment variable: {name}")
    return value


def load_settings(env: dict | None = None) -> Settings:
    """Build Settings from environment variables (defaults to os.environ).

    Pass an explicit `env` mapping to load from something other than the
    real environment, e.g. in tests.
    """
    env = os.environ if env is None else env

    try:
        chat_id = int(_require(env, "TELEGRAM_CHAT_ID"))
    except ValueError as exc:
        raise ConfigError("TELEGRAM_CHAT_ID must be an integer") from exc

    allowed_raw = _require(env, "TELEGRAM_ALLOWED_USER_IDS")
    try:
        allowed_ids = [int(part.strip()) for part in allowed_raw.split(",") if part.strip()]
    except ValueError as exc:
        raise ConfigError(
            "TELEGRAM_ALLOWED_USER_IDS must be a comma-separated list of integers"
        ) from exc

    return Settings(
        reviewer_bot_token=_require(env, "REVIEWER_BOT_TOKEN"),
        publisher_bot_token=_require(env, "PUBLISHER_BOT_TOKEN"),
        telegram_chat_id=chat_id,
        telegram_allowed_user_ids=allowed_ids,
        telegram_webhook_secret=_require(env, "TELEGRAM_WEBHOOK_SECRET"),
        apify_webhook_secret=_require(env, "APIFY_WEBHOOK_SECRET"),
        sheets_url=_require(env, "SHEETS_URL"),
        deal_brand=_require(env, "DEAL_BRAND"),
    )
