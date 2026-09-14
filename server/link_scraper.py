"""Builds a scraped-deal-shaped dict from a single product page URL, for
the "paste a link" flow in main.py — the manual counterpart to deals that
normally arrive automatically from the Apify actor.

Extraction is regex-based Open Graph / Twitter Card meta-tag reading, not a
full HTML parser: big retail product pages (Nike, adidas, Foot Locker, most
Shopify/WooCommerce stores) reliably expose `og:title`, `og:image`, and a
`product:price:amount`/`og:price:amount` meta tag, and reading just those
four tags avoids adding a DOM-parsing dependency to this project for a job
regex handles fine. A page that doesn't expose them raises LinkScrapeError
naming what's missing, rather than guessing.
"""
from __future__ import annotations

import ipaddress
import re
from html import unescape
from urllib.parse import urlparse

import httpx

_MAX_HTML_BYTES = 3_000_000
_USER_AGENT = "Mozilla/5.0 (compatible; DripITLinkBot/1.0; +https://github.com/)"

_TITLE_PROPS = ["og:title", "twitter:title"]
_IMAGE_PROPS = ["og:image", "og:image:secure_url", "twitter:image"]
_PRICE_PROPS = ["product:price:amount", "og:price:amount"]


class LinkScrapeError(RuntimeError):
    """Raised when a product link can't be fetched or doesn't expose the
    meta tags this scraper looks for."""


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

    missing = [name for name, value in [("title", title), ("image", image_url), ("price", price_raw)] if not value]
    if missing:
        raise LinkScrapeError(
            f"Couldn't find {', '.join(missing)} on that page — it may not expose Open Graph product tags."
        )

    try:
        price = float(price_raw.replace(",", ""))
    except ValueError as exc:
        raise LinkScrapeError(f"Found a price tag but couldn't parse it: {price_raw!r}") from exc

    return {"title": title, "image_url": image_url, "price": price}
