"""Renders the 1080x1080 promo banner with Pillow.

Design: a clean white-background product banner — large centered photo, a
plain black price, a small offer tag and brand mark, all set in the same
black/white palette as the drip_ittt brand itself. This follows the same
plain-background convention competitor banners (and the previous hand-made
banner) use, rather than trying to out-concept them; the goal here is
executing that familiar formula with more polish, not replacing it.

Fonts are vendored under assets/fonts/ (SIL OFL licensed, see the OFL.txt
files alongside them) rather than loaded from the OS, for the same reason
the old code avoided `arial.ttf`: Render's Linux containers don't ship
consumer system fonts, so anything not bundled with the repo silently
falls back to an illegible default.
"""
from __future__ import annotations

import io
import re

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path

CANVAS_SIZE = (1080, 1080)

_FONT_DIR = Path(__file__).resolve().parent / "assets" / "fonts"
_LOGO_DIR = Path(__file__).resolve().parent / "assets" / "logos"

_PAPER = "#FFFFFF"
_INK = "#1E1B18"
_MUTED = "#8A8177"
_ON_DARK = "#FFFFFF"

# Product-title keyword -> (display name, vendored brand mark). Matched as
# a whole word so "Puma" doesn't fire on some unrelated "pumas" substring,
# etc. First match wins; no match just means no brand was recognized.
# `detect_brand` is the reusable piece other modules (main.py's caption and
# order-row building) import; `_detect_brand_logo` is the image-only half.
_BRANDS: list[tuple[str, re.Pattern[str], str]] = [
    ("Nike", re.compile(r"\bnike\b", re.IGNORECASE), "nike.png"),
    ("Adidas", re.compile(r"\badidas\b", re.IGNORECASE), "adidas.png"),
    ("Puma", re.compile(r"\bpuma\b", re.IGNORECASE), "puma.png"),
    ("Under Armour", re.compile(r"\bunder[\s_-]?armour\b", re.IGNORECASE), "under_armour.png"),
]


def detect_brand(product_title: str) -> str | None:
    """The recognized shoe brand's display name (e.g. "Nike"), or None."""
    for name, pattern, _ in _BRANDS:
        if pattern.search(product_title):
            return name
    return None


def _detect_brand_logo(product_title: str) -> Path | None:
    for name, pattern, filename in _BRANDS:
        if pattern.search(product_title):
            return _LOGO_DIR / filename
    return None


class ImageRenderError(RuntimeError):
    """Raised when the product image can't be downloaded or decoded."""


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_FONT_DIR / name), size=size)


def _draw_tracked(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: str,
    tracking: float = 2.0,
    align: str = "l",
) -> float:
    """Draws letter-spaced text (Pillow has no built-in tracking) and
    returns its total width. `align` is 'l', 'm', or 'r' around x."""
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * max(len(text) - 1, 0)
    if align == "m":
        cursor = x - total / 2
    elif align == "r":
        cursor = x - total
    else:
        cursor = x
    for ch, w in zip(text, widths):
        draw.text((cursor, y), ch, font=font, fill=fill, anchor="lm")
        cursor += w + tracking
    return total


def _fit_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: float) -> str:
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "…", font=font) > max_width:
        text = text[:-1].rstrip()
    return f"{text}…" if text else "…"


def _autosize_font(
    draw: ImageDraw.ImageDraw, name: str, text: str, max_width: float, start_size: int, min_size: int = 28
) -> ImageFont.FreeTypeFont:
    """Shrinks a font to fit `text` in `max_width` instead of truncating it —
    for numbers like the price, cutting characters off is never acceptable."""
    size = start_size
    font = _font(name, size)
    while size > min_size and draw.textlength(text, font=font) > max_width:
        size -= 2
        font = _font(name, size)
    return font


def _draw_pill(
    draw: ImageDraw.ImageDraw, x: float, y: float, text: str, font: ImageFont.FreeTypeFont, bg: str, fg: str
) -> None:
    pad_x, pad_y = 20, 12
    w = draw.textlength(text, font=font)
    h = font.size
    box = [x, y, x + w + pad_x * 2, y + h + pad_y * 2]
    draw.rounded_rectangle(box, radius=(h + pad_y * 2) / 2, fill=bg)
    draw.text((x + pad_x, y + pad_y + h / 2), text, font=font, fill=fg, anchor="lm")


def _draw_facebook_icon(canvas: Image.Image, box: tuple[float, float, float, float]) -> None:
    x0, y0, x1, y1 = box
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=(x1 - x0) * 0.24, fill="#1877F2")
    f = _font("ArchivoBlack-Regular.ttf", int((y1 - y0) * 0.66))
    draw.text(((x0 + x1) / 2 + (x1 - x0) * 0.03, (y0 + y1) / 2 + (y1 - y0) * 0.02), "f", font=f, fill="#FFFFFF", anchor="mm")


def _instagram_gradient(w: int, h: int) -> Image.Image:
    # Approximates the Instagram mark's blue -> magenta -> orange diagonal.
    stops = [(64, 93, 230), (193, 53, 132), (245, 133, 41)]
    img = Image.new("RGB", (w, h))
    px = img.load()
    span = max(w + h - 2, 1)
    for yy in range(h):
        for xx in range(w):
            t = (xx + (h - 1 - yy)) / span
            if t <= 0.5:
                a, b, local_t = stops[0], stops[1], t / 0.5
            else:
                a, b, local_t = stops[1], stops[2], (t - 0.5) / 0.5
            px[xx, yy] = tuple(int(a[i] + (b[i] - a[i]) * local_t) for i in range(3))
    return img


def _draw_instagram_icon(canvas: Image.Image, box: tuple[float, float, float, float]) -> None:
    x0, y0, x1, y1 = box
    w, h = int(x1 - x0), int(y1 - y0)
    grad = _instagram_gradient(w, h)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=w * 0.24, fill=255)
    canvas.paste(grad, (int(x0), int(y0)), mask=mask)

    draw = ImageDraw.Draw(canvas)
    stroke = max(2, round(w * 0.07))
    pad = w * 0.20
    draw.rounded_rectangle([x0 + pad, y0 + pad, x1 - pad, y1 - pad], radius=w * 0.12, outline="#FFFFFF", width=stroke)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = w * 0.15
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline="#FFFFFF", width=stroke)
    dot_r = w * 0.035
    dot_cx, dot_cy = x1 - pad - dot_r * 1.4, y0 + pad + dot_r * 1.4
    draw.ellipse([dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r], fill="#FFFFFF")


def _draw_social_row(canvas: Image.Image, cy: float, handle: str) -> None:
    draw = ImageDraw.Draw(canvas)
    icon_size = 46
    gap = 14
    font_handle = _font("SpaceMono-Bold.ttf", 24)
    handle_w = draw.textlength(handle, font=font_handle)

    total_w = icon_size + gap + icon_size + gap + handle_w
    start_x = CANVAS_SIZE[0] / 2 - total_w / 2

    fb_box = (start_x, cy - icon_size / 2, start_x + icon_size, cy + icon_size / 2)
    _draw_facebook_icon(canvas, fb_box)

    ig_x0 = fb_box[2] + gap
    ig_box = (ig_x0, cy - icon_size / 2, ig_x0 + icon_size, cy + icon_size / 2)
    _draw_instagram_icon(canvas, ig_box)

    draw = ImageDraw.Draw(canvas)  # canvas pixels changed above; re-bind for text
    draw.text((ig_box[2] + gap, cy + 2), handle, font=font_handle, fill=_INK, anchor="lm")


def _draw_brand_logo(canvas: Image.Image, logo_path: Path, x: float, y: float, max_w: float, max_h: float) -> None:
    logo = Image.open(logo_path).convert("RGBA")
    logo.thumbnail((int(max_w), int(max_h)), Image.Resampling.LANCZOS)
    paste_y = y + (max_h - logo.height) / 2
    canvas.paste(logo, (int(x), int(paste_y)), mask=logo)


def _draw_price(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], price_text: str) -> None:
    """Price alone, no callout box behind it — just the brand-font numeral
    in black with a small unit label beside it."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    font_unit = _font("SpaceMono-Bold.ttf", 28)
    unit_w = draw.textlength("TAKA", font=font_unit)

    # The price is the one thing on this banner that must never be
    # truncated — shrink it to fit instead of cutting digits off.
    max_price_w = (x1 - x0) - unit_w - 40
    font_price = _autosize_font(draw, "AlfaSlabOne-Regular.ttf", price_text, max_price_w, start_size=92)
    price_w = draw.textlength(price_text, font=font_price)

    gap = 20
    total_w = price_w + gap + unit_w
    start_x = cx - total_w / 2
    draw.text((start_x, cy), price_text, font=font_price, fill=_INK, anchor="lm")
    draw.text((start_x + price_w + gap, cy + 6), "TAKA", font=font_unit, fill=_MUTED, anchor="lm")


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

    canvas = Image.new("RGB", CANVAS_SIZE, color=_PAPER)

    # Product photo: large and centered, with a soft drop shadow for depth.
    product_box = (90, 190, 990, 760)
    product_img.thumbnail(
        (product_box[2] - product_box[0] - 40, product_box[3] - product_box[1] - 20), Image.Resampling.LANCZOS
    )
    p_width, p_height = product_img.size
    p_x = (CANVAS_SIZE[0] - p_width) // 2
    p_y = product_box[1] + (product_box[3] - product_box[1] - p_height) // 2

    shadow_layer = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    shadow_alpha = product_img.split()[-1].point(lambda a: int(a * 0.30))
    shadow_silhouette = Image.new("RGBA", product_img.size, (20, 15, 10, 0))
    shadow_silhouette.putalpha(shadow_alpha)
    shadow_layer.paste(shadow_silhouette, (p_x + 8, p_y + 16), mask=shadow_silhouette)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(16))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow_layer).convert("RGB")

    canvas.paste(product_img, (p_x, p_y), mask=product_img)

    draw = ImageDraw.Draw(canvas)

    # Brand mark, top-right — small and out of the way, matching the
    # drip_it. logo's own lowercase/underscore/full-stop styling.
    font_brand = _font("AlfaSlabOne-Regular.ttf", 30)
    font_brand_tag = _font("SpaceMono-Regular.ttf", 13)
    draw.text((990, 64), "drip_it.", font=font_brand, fill=_INK, anchor="rm")
    _draw_tracked(draw, 990, 96, "MALAYSIA PRE-ORDER", font_brand_tag, _MUTED, tracking=2, align="r")

    # The item's own brand mark, top-left — mirrors drip_it.'s wordmark on
    # the right. Detected from the product title; simply omitted (with the
    # offer tag taking its usual top spot) if the brand isn't one of the
    # ones vendored in assets/logos/.
    logo_path = _detect_brand_logo(product_title)
    tag_y = 56
    if logo_path is not None and logo_path.exists():
        _draw_brand_logo(canvas, logo_path, 90, 54, 190, 46)
        draw = ImageDraw.Draw(canvas)  # canvas pixels changed above; re-bind
        tag_y = 112

    # Offer tag, top-left, below the brand mark when there is one.
    font_tag = _font("SpaceMono-Bold.ttf", 17)
    tag_text = _fit_text(draw, offer_text.upper(), font_tag, 560)
    _draw_pill(draw, 90, tag_y, tag_text, font_tag, _INK, _ON_DARK)

    # Product title, centered under the photo, set in the brand's own face.
    font_title = _font("AlfaSlabOne-Regular.ttf", 40)
    title = _fit_text(draw, product_title.upper(), font_title, 960)
    draw.text((CANVAS_SIZE[0] // 2, 812), title, font=font_title, fill=_INK, anchor="mm")

    _draw_price(draw, (90, 866, 990, 1006), price_text)

    _draw_social_row(canvas, 1042, "drip_ittt")

    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()
