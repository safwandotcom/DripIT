import httpx
import pytest
import respx

from link_scraper import LinkScrapeError, scrape_product_link


def _og_html(title="Air Max 90", image="https://cdn.example.com/shoe.jpg", price="129.99") -> str:
    return f"""
    <html><head>
        <meta property="og:title" content="{title}">
        <meta property="og:image" content="{image}">
        <meta property="product:price:amount" content="{price}">
        <meta property="product:price:currency" content="MYR">
    </head><body></body></html>
    """


@respx.mock
async def test_scrape_product_link_extracts_title_image_price():
    respx.get("https://shop.example.com/item").mock(
        return_value=httpx.Response(200, content=_og_html().encode())
    )

    result = await scrape_product_link("https://shop.example.com/item")

    assert result == {"title": "Air Max 90", "image_url": "https://cdn.example.com/shoe.jpg", "price": 129.99}


@respx.mock
async def test_scrape_product_link_handles_attribute_order_and_entities():
    html = """
    <meta content="Air &amp; Max" property="og:title">
    <meta content="https://cdn.example.com/i.jpg" property="og:image">
    <meta content="1,299.50" property="og:price:amount">
    """
    respx.get("https://shop.example.com/item2").mock(return_value=httpx.Response(200, content=html.encode()))

    result = await scrape_product_link("https://shop.example.com/item2")

    assert result["title"] == "Air & Max"
    assert result["price"] == 1299.50


@respx.mock
async def test_scrape_product_link_raises_when_tags_missing():
    respx.get("https://shop.example.com/bare").mock(
        return_value=httpx.Response(200, content=b"<html><body>no tags here</body></html>")
    )

    with pytest.raises(LinkScrapeError, match="title, image, price"):
        await scrape_product_link("https://shop.example.com/bare")


@respx.mock
async def test_scrape_product_link_raises_on_http_error():
    respx.get("https://shop.example.com/missing").mock(return_value=httpx.Response(404))

    with pytest.raises(LinkScrapeError):
        await scrape_product_link("https://shop.example.com/missing")


@pytest.mark.parametrize(
    "url",
    [
        "ftp://shop.example.com/item",
        "file:///etc/passwd",
        "http://localhost/item",
        "http://127.0.0.1/item",
        "http://169.254.169.254/latest/meta-data/",
        "not-a-url-at-all",
    ],
)
async def test_scrape_product_link_rejects_unsafe_urls(url):
    with pytest.raises(LinkScrapeError):
        await scrape_product_link(url)
