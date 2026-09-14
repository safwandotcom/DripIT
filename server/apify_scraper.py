"""Fetches a single product page's data via the Apify actor's rendered
browser, for the paste-a-link flow when the URL is on a site whose product
data doesn't exist in a plain HTTP response at all — Shein confirmed: no
Open Graph tags, no JSON-LD, nothing until client-side JS runs. link_scraper
(a plain httpx GET) can never work there no matter what headers are sent,
because the data genuinely isn't in the response.

Calls Apify's run-sync-get-dataset-items endpoint: this runs the actor with
a single `product_url` input and returns the resulting dataset item(s)
directly in the response once the run finishes — no webhook or polling
needed for this on-demand path. The actor's own scheduled sale-page runs
still go through /webhook/scraper-deal exactly as before; this is a second,
independent entry point into the same actor.
"""
from __future__ import annotations

import httpx

_RUN_SYNC_URL = "https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"

# A real run means a real browser launching, rendering, and running JS on a
# remote page — generously longer than link_scraper's plain-fetch timeout.
_TIMEOUT = httpx.Timeout(120.0, connect=15.0)


class ApifyLinkScrapeError(RuntimeError):
    """Raised when the Apify actor isn't configured, its run fails, or it
    returns no usable product data for a single-link scrape request."""


async def scrape_product_link_via_apify(
    url: str,
    api_token: str,
    actor_id: str,
    client: httpx.AsyncClient | None = None,
) -> dict:
    """Runs the actor against a single product `url` and returns
    {"title", "image_url", "price"} — the same shape link_scraper's
    scrape_product_link returns, so callers don't need to care which
    scraper handled a given link."""
    if not api_token:
        raise ApifyLinkScrapeError(
            "This site needs a rendered-browser scrape and APIFY_API_TOKEN isn't configured — ask the owner to set it up."
        )

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=_TIMEOUT)
    try:
        try:
            # The token goes in the Authorization header, never the URL —
            # httpx's own exception messages include the full request URL,
            # and a query-string token would ride straight along into any
            # error text a caller surfaces to a user (this main.py surfaces
            # ApifyLinkScrapeError's message directly into a Telegram
            # reply). Keeping the secret out of the URL is what makes that
            # safe, not any later formatting choice below.
            response = await client.post(
                _RUN_SYNC_URL.format(actor_id=actor_id),
                headers={"Authorization": f"Bearer {api_token}"},
                json={"product_url": url},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # Surface the response body (Apify's own error detail, never
            # secret) rather than str(exc), which includes the request URL.
            detail = exc.response.text.strip()[:300]
            raise ApifyLinkScrapeError(f"The Apify actor run failed ({exc.response.status_code}): {detail}") from exc
        except httpx.HTTPError as exc:
            # No response to read a safe detail from (timeout, connection
            # failure, etc.) — name the failure without formatting the
            # exception itself, for the same reason as above.
            raise ApifyLinkScrapeError(f"The Apify actor run failed: {type(exc).__name__}") from exc
    finally:
        if owns_client:
            await client.aclose()

    try:
        items = response.json()
    except ValueError as exc:
        raise ApifyLinkScrapeError("The Apify actor returned an unreadable response.") from exc

    if not items:
        raise ApifyLinkScrapeError("The Apify actor didn't find any product data on that page.")

    item = items[0]
    title = item.get("title")
    image_url = item.get("image_url")
    price = item.get("myr_price")
    missing = [name for name, value in [("title", title), ("image", image_url), ("price", price)] if not value]
    if missing:
        raise ApifyLinkScrapeError(f"The Apify actor result was missing {', '.join(missing)}.")

    try:
        price = float(price)
    except (TypeError, ValueError) as exc:
        raise ApifyLinkScrapeError(f"The Apify actor returned an unparseable price: {price!r}") from exc

    return {"title": str(title), "image_url": str(image_url), "price": price}
