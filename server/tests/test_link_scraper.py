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


def _json_ld_html(*, og_title: bool = False) -> str:
    # Trimmed but structurally faithful to a real underarmour.com.my product
    # page: og:title present but no bare og:image and no price meta tag at
    # all — everything else has to come from the Product JSON-LD.
    og = '<meta property="og:title" content="UA Pulse">' if og_title else ""
    return f"""
    <html><head>
        {og}
        <meta name="og:image:width" content="256" />
        <script type="application/ld+json">
        [{{"@context":"http://schema.org/","@type":"Product","name":"UA Pulse",
           "image":["https://underarmour.scene7.com/is/image/Underarmour/6011642-001_DEFAULT",
                     "https://underarmour.scene7.com/is/image/Underarmour/6011642-001_A"],
           "offers":{{"@type":"Offer","priceCurrency":"MYR","price":"379.00","availability":"http://schema.org/InStock"}}}},
         {{"@context":"http://schema.org/","@type":"BreadcrumbList","itemListElement":[]}}]
        </script>
    </head><body></body></html>
    """


@respx.mock
async def test_scrape_product_link_falls_back_to_json_ld_product_when_og_incomplete():
    # This is the real-world case that motivated the fallback: Under Armour
    # sets og:image:width/height/type but never a bare og:image, and no
    # price meta tag at all.
    respx.get("https://www.underarmour.com.my/product").mock(
        return_value=httpx.Response(200, content=_json_ld_html(og_title=True).encode())
    )

    result = await scrape_product_link("https://www.underarmour.com.my/product")

    assert result == {
        "title": "UA Pulse",
        "image_url": "https://underarmour.scene7.com/is/image/Underarmour/6011642-001_DEFAULT",
        "price": 379.0,
    }


@respx.mock
async def test_scrape_product_link_uses_json_ld_for_every_field_when_no_og_tags_at_all():
    respx.get("https://www.underarmour.com.my/product2").mock(
        return_value=httpx.Response(200, content=_json_ld_html(og_title=False).encode())
    )

    result = await scrape_product_link("https://www.underarmour.com.my/product2")

    assert result["title"] == "UA Pulse"
    assert result["price"] == 379.0


@respx.mock
async def test_scrape_product_link_prefers_og_tags_over_json_ld_when_both_present():
    html = _json_ld_html(og_title=True).replace(
        "</head>",
        '<meta property="og:image" content="https://cdn.example.com/og-image.jpg">'
        '<meta property="og:price:amount" content="999.00"></head>',
    )
    respx.get("https://www.underarmour.com.my/product3").mock(return_value=httpx.Response(200, content=html.encode()))

    result = await scrape_product_link("https://www.underarmour.com.my/product3")

    assert result["image_url"] == "https://cdn.example.com/og-image.jpg"
    assert result["price"] == 999.0


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
