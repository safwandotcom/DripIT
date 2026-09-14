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
    assert sent.url.params["token"] == "test-token"
    import json as _json
    assert _json.loads(sent.content)["product_url"] == "https://my.shein.com/some-product-p-123.html"


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
