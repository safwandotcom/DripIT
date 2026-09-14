import json

import httpx
import pytest
import respx

from apify_scraper import ApifyLinkScrapeError, scrape_product_link_via_apify

RUN_SYNC_URL = "https://api.apify.com/v2/acts/some-actor-id/run-sync-get-dataset-items"


@respx.mock
async def test_scrape_product_link_via_apify_returns_normalized_fields():
    route = respx.post(RUN_SYNC_URL).mock(
        return_value=httpx.Response(
            200,
            json=[{"title": "Sodalemon Chunky Sneakers", "image_url": "https://img.ltwebstatic.com/x.webp", "myr_price": 72.25}],
        )
    )

    result = await scrape_product_link_via_apify(
        "https://my.shein.com/some-product-p-123.html", "test-token", "some-actor-id"
    )

    assert result == {
        "title": "Sodalemon Chunky Sneakers",
        "image_url": "https://img.ltwebstatic.com/x.webp",
        "price": 72.25,
    }
    sent = route.calls.last.request
    # The token must go in the Authorization header, never the URL — a
    # query-string token would ride along into any exception message that
    # includes the request URL (httpx's default str() does), and this
    # backend surfaces ApifyLinkScrapeError's message straight into a
    # Telegram reply. "token" must never appear as a URL query param.
    assert "token" not in sent.url.params
    assert sent.headers["Authorization"] == "Bearer test-token"
    assert json.loads(sent.content)["product_url"] == "https://my.shein.com/some-product-p-123.html"


@respx.mock
async def test_scrape_product_link_via_apify_error_message_never_contains_the_token():
    # The actual bug this guards against: an HTTP failure's error message
    # reaching a Telegram reply must not be able to leak the token under
    # any circumstance, including if a future change reintroduces it into
    # the URL somehow.
    respx.post(RUN_SYNC_URL).mock(return_value=httpx.Response(400, text="Bad input: product_url is required"))

    with pytest.raises(ApifyLinkScrapeError) as exc_info:
        await scrape_product_link_via_apify("https://my.shein.com/x-p-1.html", "super-secret-token", "some-actor-id")

    assert "super-secret-token" not in str(exc_info.value)
    assert "Bad input" in str(exc_info.value)


@respx.mock
async def test_scrape_product_link_via_apify_raises_when_no_items_returned():
    respx.post(RUN_SYNC_URL).mock(return_value=httpx.Response(200, json=[]))

    with pytest.raises(ApifyLinkScrapeError, match="didn't find any product data"):
        await scrape_product_link_via_apify("https://my.shein.com/x-p-1.html", "test-token", "some-actor-id")


@respx.mock
async def test_scrape_product_link_via_apify_raises_when_item_missing_fields():
    respx.post(RUN_SYNC_URL).mock(return_value=httpx.Response(200, json=[{"title": "Only a title"}]))

    with pytest.raises(ApifyLinkScrapeError, match="missing image, price"):
        await scrape_product_link_via_apify("https://my.shein.com/x-p-1.html", "test-token", "some-actor-id")


@respx.mock
async def test_scrape_product_link_via_apify_raises_on_http_error():
    respx.post(RUN_SYNC_URL).mock(return_value=httpx.Response(500))

    with pytest.raises(ApifyLinkScrapeError, match="actor run failed"):
        await scrape_product_link_via_apify("https://my.shein.com/x-p-1.html", "test-token", "some-actor-id")


async def test_scrape_product_link_via_apify_raises_when_token_missing():
    with pytest.raises(ApifyLinkScrapeError, match="APIFY_API_TOKEN isn't configured"):
        await scrape_product_link_via_apify("https://my.shein.com/x-p-1.html", "", "some-actor-id")
