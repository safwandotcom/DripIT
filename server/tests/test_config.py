import pytest

from config import ConfigError, load_settings

BASE_ENV = {
    "REVIEWER_BOT_TOKEN": "r-token",
    "PUBLISHER_BOT_TOKEN": "p-token",
    "TELEGRAM_CHAT_ID": "-1001234567890",
    "TELEGRAM_ALLOWED_USER_IDS": "111, 222",
    "TELEGRAM_WEBHOOK_SECRET": "wh-secret",
    "APIFY_WEBHOOK_SECRET": "apify-secret",
    "SHEETS_URL": "https://script.google.com/macros/s/test/exec",
    "DEAL_BRAND": "drip_ittt",
}


def test_load_settings_parses_valid_env():
    settings = load_settings(dict(BASE_ENV))
    assert settings.reviewer_bot_token == "r-token"
    assert settings.telegram_chat_id == -1001234567890
    assert settings.telegram_allowed_user_ids == [111, 222]
    assert settings.deal_brand == "drip_ittt"


def test_load_settings_raises_on_missing_var():
    env = dict(BASE_ENV)
    del env["REVIEWER_BOT_TOKEN"]
    with pytest.raises(ConfigError, match="REVIEWER_BOT_TOKEN"):
        load_settings(env)


def test_load_settings_raises_on_invalid_brand():
    env = dict(BASE_ENV)
    env["DEAL_BRAND"] = "SomeOtherBrand"
    with pytest.raises(ConfigError):
        load_settings(env)


def test_load_settings_raises_on_non_integer_chat_id():
    env = dict(BASE_ENV)
    env["TELEGRAM_CHAT_ID"] = "not-a-number"
    with pytest.raises(ConfigError):
        load_settings(env)


def test_load_settings_raises_on_non_integer_allowed_ids():
    env = dict(BASE_ENV)
    env["TELEGRAM_ALLOWED_USER_IDS"] = "111,not-a-number"
    with pytest.raises(ConfigError):
        load_settings(env)
