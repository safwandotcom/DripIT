import pytest
from pydantic import ValidationError

from models import PENDING_ACTIONS, PENDING_STATUSES, ScraperDeal


def test_scraper_deal_parses_valid_payload():
    deal = ScraperDeal(
        deal_id="d1", title="Air Max 90", myr_price=350, sizes="40,41", image_url="https://x/img.jpg"
    )
    assert deal.myr_price == 350.0


def test_scraper_deal_coerces_price_string_with_currency_prefix():
    deal = ScraperDeal(
        deal_id="d1", title="Air Max 90", myr_price="RM 350.50", sizes="40", image_url="https://x/img.jpg"
    )
    assert deal.myr_price == 350.5


def test_scraper_deal_requires_title():
    with pytest.raises(ValidationError):
        ScraperDeal(deal_id="d1", myr_price=350, sizes="40", image_url="https://x/img.jpg")


def test_scraper_deal_rejects_deal_id_with_invalid_characters():
    with pytest.raises(ValidationError):
        ScraperDeal(
            deal_id="bad]id", title="X", myr_price=1, sizes="1", image_url="https://x/i.jpg"
        )


def test_scraper_deal_rejects_deal_id_too_long():
    with pytest.raises(ValidationError):
        ScraperDeal(
            deal_id="a" * 41, title="X", myr_price=1, sizes="1", image_url="https://x/i.jpg"
        )


def test_pending_action_constants_match_callback_data_values():
    assert PENDING_ACTIONS == ("postonly", "createorder")
    assert "awaiting_price" in PENDING_STATUSES
    assert "published" in PENDING_STATUSES
