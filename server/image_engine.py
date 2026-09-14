"""Renders the 1080x1080 promo banner with Pillow.

Design: follows the owner's own hand-drawn sample layout exactly — a plain
"PRE-ORDER FROM MALAYSIA" header, the drip_ittt wordmark, a bordered frame
around the product photo, product name + price beneath it, and a footer
split between social handles (left) and a phone number (right). Black
text/ink on white, matching the brand's own black/white palette.

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
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from pathlib import Path

CANVAS_SIZE = (1080, 1080)

_FONT_DIR = Path(__file__).resolve().parent / "assets" / "fonts"

_PAPER = "#FFFFFF"
_INK = "#1E1B18"
_MUTED = "#8A8177"

_HANDLE = "drip_ittt"
_PHONE = "01843800538"

# Product-title keyword -> brand display name. Matched as a whole word so
# "Puma" doesn't fire on some unrelated "pumas" substring, etc. First match
# wins; no match just means no brand was recognized. Used by main.py for
# the "Brand:" caption line and the order row's productBrand field — no
# longer drawn on the banner itself (dropped to match the owner's sample).
_BRANDS: list[tuple[str, re.Pattern[str]]] = [
    ("Nike", re.compile(r"\bnike\b", re.IGNORECASE)),
    ("Adidas", re.compile(r"\badidas\b", re.IGNORECASE)),
    ("Puma", re.compile(r"\bpuma\b", re.IGNORECASE)),
    ("Under Armour", re.compile(r"\bunder[\s_-]?armour\b", re.IGNORECASE)),
]


def detect_brand(product_title: str) -> str | None:
    """The recognized shoe brand's display name (e.g. "Nike"), or None."""
    for name, pattern in _BRANDS:
        if pattern.search(product_title):
            return name
    return None


# A scraped/pasted product title is a full catalog listing title, not the
# short name a banner should show (e.g. "Nike Air Zoom Pegasus Plus 2 -
# Men's Road Running Shoes" instead of just "Nike Pegasus Plus 2"). Two
# passes clean it up for display: cut at the first delimiter a retailer
# uses to append trailing category/color/size text, then strip a leftover
# trailing gender+category phrase for titles with no delimiter at all.
_TITLE_DELIMITER_PATTERN = re.compile(r"\s+[-|]\s+|,\s*")
_TITLE_TRAILING_NOISE_PATTERN = re.compile(
    r"\s+(?:for\s+)?(?:men'?s?|women'?s?|kids?'?|unisex)?\s*(?:road\s+)?(?:running\s+)?"
    r"(?:shoes?|sneakers?|trainers?|footwear)\s*$",
    re.IGNORECASE,
)


def _simplify_title(title: str) -> str:
    """Trims retailer boilerplate from a scraped product title for banner
    display. Falls back to the original (or the delimiter-cut) title if a
    step would otherwise leave nothing."""
    cut = _TITLE_DELIMITER_PATTERN.split(title, maxsplit=1)[0].strip() or title.strip()
    trimmed = _TITLE_TRAILING_NOISE_PATTERN.sub("", cut).strip()
    return trimmed or cut


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


def _draw_facebook_icon(canvas: Image.Image, box: tuple[float, float, float, float]) -> None:
    x0, y0, x1, y1 = box
    draw = ImageDraw.Draw(canvas)
    draw.ellipse([x0, y0, x1, y1], fill="#1877F2")
    f = _font("ArchivoBlack-Regular.ttf", round((y1 - y0) * 0.62))
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
    ImageDraw.Draw(mask).ellipse([0, 0, w - 1, h - 1], fill=255)
    canvas.paste(grad, (int(x0), int(y0)), mask=mask)

    draw = ImageDraw.Draw(canvas)
    stroke = max(2, round(w * 0.07))
    pad = w * 0.22
    draw.rounded_rectangle([x0 + pad, y0 + pad, x1 - pad, y1 - pad], radius=w * 0.12, outline="#FFFFFF", width=stroke)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = w * 0.14
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline="#FFFFFF", width=stroke)
    dot_r = w * 0.035
    dot_cx, dot_cy = x1 - pad - dot_r * 1.2, y0 + pad + dot_r * 1.2
    draw.ellipse([dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r], fill="#FFFFFF")


def _draw_phone_icon(canvas: Image.Image, box: tuple[float, float, float, float]) -> None:
    """A minimal flat handset glyph: a rounded bar with a circle at each
    end, rotated 45° — drawn from scratch since the vendored text fonts
    carry no emoji/symbol glyphs to fall back on."""
    x0, y0, x1, y1 = box
    draw = ImageDraw.Draw(canvas)
    draw.ellipse([x0, y0, x1, y1], fill=_INK)

    size = round(x1 - x0)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    mid = size / 2
    # Two fat rounded "ear/mouthpiece" ends, symmetric about the center,
    # joined by a visibly thinner bar — a plain dumbbell silhouette reads
    # as a phone handset once rotated; asymmetric placement here previously
    # fused the ends into an unrecognizable blob.
    half_span = size * 0.25
    er = size * 0.115
    bar_w, bar_half_len = size * 0.075, half_span - er * 0.2
    ld.rounded_rectangle(
        [mid - bar_w / 2, mid - bar_half_len, mid + bar_w / 2, mid + bar_half_len], radius=bar_w / 2, fill="#FFFFFF"
    )
    ld.ellipse([mid - er, mid - half_span - er, mid + er, mid - half_span + er], fill="#FFFFFF")
    ld.ellipse([mid - er, mid + half_span - er, mid + er, mid + half_span + er], fill="#FFFFFF")
    rotated = layer.rotate(45, resample=Image.BICUBIC)
    canvas.paste(rotated, (round(x0), round(y0)), mask=rotated)


def _draw_footer(canvas: Image.Image, cy: float) -> None:
    """Social handle bottom-left, phone number bottom-right — matches the
    two-corner footer layout in the owner's sample exactly."""
    draw = ImageDraw.Draw(canvas)
    icon_size, icon_gap, text_gap = 44, 10, 14
    font_text = _font("SpaceMono-Bold.ttf", 24)

    left_x = 70
    fb_box = (left_x, cy - icon_size / 2, left_x + icon_size, cy + icon_size / 2)
    _draw_facebook_icon(canvas, fb_box)
    ig_x0 = fb_box[2] + icon_gap
    ig_box = (ig_x0, cy - icon_size / 2, ig_x0 + icon_size, cy + icon_size / 2)
    _draw_instagram_icon(canvas, ig_box)
    draw = ImageDraw.Draw(canvas)  # canvas pixels changed above; re-bind
    draw.text((ig_box[2] + text_gap, cy + 2), _HANDLE, font=font_text, fill=_INK, anchor="lm")

    right_x = 1010
    phone_w = draw.textlength(_PHONE, font=font_text)
    phone_x0 = right_x - icon_size - text_gap - phone_w
    phone_box = (phone_x0, cy - icon_size / 2, phone_x0 + icon_size, cy + icon_size / 2)
    _draw_phone_icon(canvas, phone_box)
    draw = ImageDraw.Draw(canvas)
    draw.text((phone_box[2] + text_gap, cy + 2), _PHONE, font=font_text, fill=_INK, anchor="lm")


def _draw_price(draw: ImageDraw.ImageDraw, cx: float, cy: float, max_width: float, price_text: str) -> None:
    """The price, centered on (cx, cy) — no callout box, just the
    brand-font numeral with a small unit label beside it."""
    font_unit = _font("SpaceMono-Bold.ttf", 26)
    unit_w = draw.textlength("TAKA", font=font_unit)

    # The price is the one thing on this banner that must never be
    # truncated — shrink it to fit instead of cutting digits off.
    font_price = _autosize_font(draw, "AlfaSlabOne-Regular.ttf", price_text, max_width - unit_w - 20, start_size=72)
    price_w = draw.textlength(price_text, font=font_price)

    gap = 18
    total_w = price_w + gap + unit_w
    start_x = cx - total_w / 2
    draw.text((start_x, cy), price_text, font=font_price, fill=_INK, anchor="lm")
    draw.text((start_x + price_w + gap, cy + 5), "TAKA", font=font_unit, fill=_MUTED, anchor="lm")


def _key_out_flat_background(img: Image.Image, low: int = 12, high: int = 40) -> Image.Image:
    """Catalog product photos (Under Armour, Nike, etc.) are almost always
    shot on a uniform near-white/grey backdrop and saved as flat opaque
    images, not with real transparency. Pasted as-is onto this banner's own
    white ground, that backdrop shows up as a visible box around the
    product. Sample the corner as the background color and fade out
    anything close to it, so only the product itself stays opaque — this
    also makes the drop shadow drawn from this same alpha trace the
    product's silhouette instead of the whole rectangle."""
    rgb = img.convert("RGB")
    bg_color = rgb.getpixel((0, 0))
    distance = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg_color)).convert("L")
    alpha = distance.point(lambda x: max(0, min(255, round((x - low) * 255 / (high - low)))))
    result = img.convert("RGBA")
    result.putalpha(ImageChops.darker(alpha, result.getchannel("A")))
    return result


def _crop_to_opaque_bbox(img: Image.Image, alpha_threshold: int = 10) -> Image.Image:
    """Crops away the transparent margin left around the product after
    keying out its background. Without this, a catalog photo shot with
    generous whitespace around the shoe (common — the keyed-out background
    is transparent, but the image's own pixel dimensions still include that
    empty margin) gets scaled down to fit that unused space too, leaving
    the product itself looking small on the banner. Cropping to the
    product's own bounding box first means the fit-to-frame scale step
    below is sized to the product, not to however much blank margin the
    source photo happened to ship with."""
    alpha = img.split()[-1]
    mask = alpha.point(lambda a: 255 if a > alpha_threshold else 0)
    bbox = mask.getbbox()
    return img.crop(bbox) if bbox else img


async def render_banner(
    product_title: str,
    image_url: str,
    price_text: str,
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

    product_img = _key_out_flat_background(product_img)
    product_img = _crop_to_opaque_bbox(product_img)

    canvas = Image.new("RGB", CANVAS_SIZE, color=_PAPER)
    draw = ImageDraw.Draw(canvas)

    # Header: "PRE-ORDER / FROM MALAYSIA" top-left, drip_ittt top-right.
    font_header = _font("ArchivoBlack-Regular.ttf", 26)
    font_brand = _font("AlfaSlabOne-Regular.ttf", 32)
    draw.text((70, 62), "PRE-ORDER", font=font_header, fill=_INK, anchor="lm")
    draw.text((70, 94), "FROM MALAYSIA", font=font_header, fill=_INK, anchor="lm")
    draw.text((1010, 78), _HANDLE, font=font_brand, fill=_INK, anchor="rm")

    # Product photo area — no border box (dropped per the owner's request
    # for a cleaner look) — with a soft drop shadow. A tighter pad now that
    # there's no frame line to keep clear of, so the product fills more of
    # the space instead of floating small in the middle of it.
    frame_box = (90, 158, 990, 660)

    pad = 16
    product_img.thumbnail(
        (frame_box[2] - frame_box[0] - pad * 2, frame_box[3] - frame_box[1] - pad * 2), Image.Resampling.LANCZOS
    )
    p_width, p_height = product_img.size
    p_x = (CANVAS_SIZE[0] - p_width) // 2
    p_y = frame_box[1] + (frame_box[3] - frame_box[1] - p_height) // 2

    shadow_layer = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    shadow_alpha = product_img.split()[-1].point(lambda a: int(a * 0.30))
    shadow_silhouette = Image.new("RGBA", product_img.size, (20, 15, 10, 0))
    shadow_silhouette.putalpha(shadow_alpha)
    shadow_layer.paste(shadow_silhouette, (p_x + 8, p_y + 14), mask=shadow_silhouette)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(14))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow_layer).convert("RGB")

    canvas.paste(product_img, (p_x, p_y), mask=product_img)
    draw = ImageDraw.Draw(canvas)

    # Product name, then price, centered beneath the frame.
    font_title = _font("ArchivoBlack-Regular.ttf", 34)
    title = _fit_text(draw, _simplify_title(product_title).upper(), font_title, 900)
    draw.text((CANVAS_SIZE[0] // 2, 710), title, font=font_title, fill=_INK, anchor="mm")

    _draw_price(draw, CANVAS_SIZE[0] / 2, 782, 900, price_text)

    _draw_footer(canvas, 1010)

    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()
