"""Builds a scraped-deal-shaped dict from a single product page URL, for
the "paste a link" flow in main.py — the manual counterpart to deals that
normally arrive automatically from the Apify actor.

Two extraction strategies, tried in order:

1. Open Graph / Twitter Card meta tags (`og:title`, `og:image`,
   `product:price:amount`/`og:price:amount`). Works for many stores, but
   NOT for all of them — Under Armour's own site, for instance, sets
   `og:image:width/height/type` but never a bare `og:image`, and never any
   price meta tag at all.
2. schema.org Product/Offer JSON-LD (`<script type="application/ld+json">`
   containing `{"@type":"Product","offers":{"price":...}}`) — what Under
   Armour and most modern storefronts (Shopify, Magento, plenty of custom
   builds) actually embed for SEO. Verified directly against a live
   underarmour.com.my product page rather than assumed.

Both are regex/json based, not a full HTML parser — reading a handful of
known shapes is enough for this job and avoids a DOM-parsing dependency.
A page exposing neither raises LinkScrapeError naming what's missing,
rather than guessing.
"""
from __future__ import annotations

import ipaddress
import json
import re
from html import unescape
from urllib.parse import urlparse

import httpx

_MAX_HTML_BYTES = 3_000_000
# A plain browser UA, not a self-identified bot string — some storefronts
# (adidas.com among them) flatly 403 anything that announces itself as a
# bot, even for a page whose product markup is meant to be publicly read.
_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

_TITLE_PROPS = ["og:title", "twitter:title"]
_IMAGE_PROPS = ["og:image", "og:image:secure_url", "twitter:image"]
_PRICE_PROPS = ["product:price:amount", "og:price:amount"]

_JSON_LD_PATTERN = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.IGNORECASE | re.DOTALL
)


class LinkScrapeError(RuntimeError):
    """Raised when a product link can't be fetched or doesn't expose the
    product data this scraper looks for."""


def _validate_public_url(url: str) -> None:
    """Rejects anything that isn't a plain http(s) link, or that names a
    literal loopback/private/link-local address directly (blocks the classic
    http://127.0.0.1/..., http://169.254.169.254/... cloud-metadata cases).

    This does NOT resolve ordinary domain names to check where they point —
    doing that would need a live DNS lookup on every pasted link, which is
    both slow and untestable against a mocked HTTP layer. That's an accepted
    gap (a domain that resolves to an internal address via DNS rebinding
    would slip through) reasonable for a tool only allowlisted reviewers can
    trigger — reconsider if this is ever exposed more broadly."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise LinkScrapeError("Only http:// or https:// links are supported.")
    hostname = parsed.hostname
    if not hostname:
        raise LinkScrapeError("Could not find a hostname in that link.")
    if hostname.lower() == "localhost" or hostname.lower().endswith(".local"):
        raise LinkScrapeError("That host isn't allowed.")
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return  # an ordinary domain name, not a literal IP
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise LinkScrapeError("That link points to a private/internal address and can't be fetched.")


def _extract_meta(html: str, prop_names: list[str]) -> str | None:
    for prop in prop_names:
        escaped = re.escape(prop)
        for pattern in (
            rf'<meta[^>]+(?:property|name)=["\']{escaped}["\'][^>]*content=["\']([^"\']*)["\']',
            rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']{escaped}["\']',
        ):
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                value = unescape(match.group(1)).strip()
                if value:
                    return value
    return None


def _iter_json_ld_nodes(data):
    """Walks a parsed JSON-LD payload and yields every dict node found.
    Handles a single object, a top-level list of objects, an `@graph`
    array, and a ProductGroup's `hasVariant` array — Nike, for one, puts
    its actual per-size Product/Offer nodes only inside hasVariant, not at
    the top level, so a walk that stops at @graph alone misses the price
    entirely."""
    if isinstance(data, list):
        for item in data:
            yield from _iter_json_ld_nodes(item)
        return
    if not isinstance(data, dict):
        return
    yield data
    for key in ("@graph", "hasVariant"):
        nested = data.get(key)
        if isinstance(nested, list):
            for item in nested:
                yield from _iter_json_ld_nodes(item)


def _json_ld_type_matches(node: dict, wanted: str) -> bool:
    node_type = node.get("@type")
    if isinstance(node_type, list):
        return wanted in node_type
    return node_type == wanted


def _extract_json_ld_product(html: str) -> dict | None:
    """Finds a schema.org Product node with a usable name/image/price and
    returns {"title", "image_url", "price_raw"}, or None."""
    for script_body in _JSON_LD_PATTERN.findall(html):
        try:
            data = json.loads(script_body.strip())
        except ValueError:
            continue

        for node in _iter_json_ld_nodes(data):
            if not _json_ld_type_matches(node, "Product"):
                continue

            title = node.get("name")

            image = node.get("image")
            if isinstance(image, list):
                image = image[0] if image else None
            elif isinstance(image, dict):
                image = image.get("url")

            offers = node.get("offers")
            if isinstance(offers, list):
                offers = offers[0] if offers else None
            price_raw = offers.get("price") if isinstance(offers, dict) else None

            if title and image and price_raw:
                return {"title": str(title).strip(), "image_url": str(image).strip(), "price_raw": str(price_raw)}
    return None


async def scrape_product_link(url: str, client: httpx.AsyncClient | None = None) -> dict:
    """Fetches `url` and returns {"title", "image_url", "price"}, or raises
    LinkScrapeError with a reviewer-readable reason."""
    _validate_public_url(url)

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=15.0, follow_redirects=True, max_redirects=5)
    try:
        try:
            async with client.stream("GET", url, headers={"User-Agent": _USER_AGENT}) as response:
                response.raise_for_status()
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > _MAX_HTML_BYTES:
                        raise LinkScrapeError("That page was too large to scan.")
                    chunks.append(chunk)
                html = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
        except httpx.HTTPError as exc:
            raise LinkScrapeError(f"Could not fetch that link: {exc}") from exc
    finally:
        if owns_client:
            await client.aclose()

    title = _extract_meta(html, _TITLE_PROPS)
    image_url = _extract_meta(html, _IMAGE_PROPS)
    price_raw = _extract_meta(html, _PRICE_PROPS)

    # Open Graph tags don't cover every field on every site (Under Armour's
    # own pages, for one, never expose a price meta tag at all) — fall back
    # to schema.org Product JSON-LD for whatever's still missing.
    if not title or not image_url or not price_raw:
        ld_product = _extract_json_ld_product(html)
        if ld_product:
            title = title or ld_product["title"]
            image_url = image_url or ld_product["image_url"]
            price_raw = price_raw or ld_product["price_raw"]

    missing = [name for name, value in [("title", title), ("image", image_url), ("price", price_raw)] if not value]
    if missing:
        raise LinkScrapeError(
            f"Couldn't find {', '.join(missing)} on that page — it exposes neither Open Graph "
            "product tags nor schema.org Product data."
        )

    try:
        price = float(price_raw.replace(",", ""))
    except ValueError as exc:
        raise LinkScrapeError(f"Found a price but couldn't parse it: {price_raw!r}") from exc

    return {"title": title, "image_url": image_url, "price": price}
