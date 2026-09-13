"""Renders the 1080x1080 promo banner with Pillow.

Uses Pillow's own bundled scalable font (`ImageFont.load_default(size=N)`,
available since Pillow 10.1) instead of relying on `arial.ttf`, which does
not exist on Render's Linux containers and would otherwise silently fall
back to a tiny, illegible bitmap font. No external font file to manage.
"""
from __future__ import annotations

import io

import httpx
from PIL import Image, ImageDraw, ImageFont

CANVAS_SIZE = (1080, 1080)
_PRODUCT_MAX_SIZE = (750, 550)
_PRODUCT_TOP = 220


class ImageRenderError(RuntimeError):
    """Raised when the product image can't be downloaded or decoded."""


async def render_banner(
    product_title: str,
    image_url: str,
    price_text: str,
    offer_text: str = "LIMITED TIME PRE-ORDER",
    client: httpx.AsyncClient | None = None,
) -> bytes:
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=15.0)
    try:
        try:
            response = await client.get(image_url)
            response.raise_for_status()
            product_img = Image.open(io.BytesIO(response.content)).convert("RGBA")
        except (httpx.HTTPError, OSError) as exc:
            raise ImageRenderError(f"Could not load product image: {exc}") from exc
    finally:
        if owns_client:
            await client.aclose()

    canvas = Image.new("RGB", CANVAS_SIZE, color=(255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    product_img.thumbnail(_PRODUCT_MAX_SIZE, Image.Resampling.LANCZOS)
    p_width, p_height = product_img.size
    p_x = (CANVAS_SIZE[0] - p_width) // 2
    p_y = _PRODUCT_TOP + (_PRODUCT_MAX_SIZE[1] - p_height) // 2
    canvas.paste(product_img, (p_x, p_y), mask=product_img)

    font_title = ImageFont.load_default(size=44)
    font_price = ImageFont.load_default(size=62)
    font_sub = ImageFont.load_default(size=26)

    center_x = CANVAS_SIZE[0] // 2
    draw.text((center_x, 100), product_title.upper(), fill="#1A2E26", font=font_title, anchor="mm")
    draw.text((center_x, 830), f"PRICE - {price_text} TAKA", fill="#1A2E26", font=font_price, anchor="mm")
    draw.text((center_x, 910), offer_text.upper(), fill="#D32F2F", font=font_sub, anchor="mm")

    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()
