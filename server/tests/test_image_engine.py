import io

import httpx
import pytest
import respx
from PIL import Image

from image_engine import (
    CANVAS_SIZE,
    ImageRenderError,
    _crop_to_opaque_bbox,
    _key_out_flat_background,
    _simplify_title,
    detect_brand,
    render_banner,
)


def _sample_png_bytes() -> bytes:
    img = Image.new("RGBA", (200, 150), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@respx.mock
async def test_render_banner_returns_canvas_sized_png():
    respx.get("https://cdn.example.com/shoe.jpg").mock(
        return_value=httpx.Response(200, content=_sample_png_bytes())
    )

    result = await render_banner("Air Max 90", "https://cdn.example.com/shoe.jpg", "7600")

    out = Image.open(io.BytesIO(result))
    assert out.format == "PNG"
    assert out.size == CANVAS_SIZE


@respx.mock
async def test_render_banner_raises_on_download_failure():
    respx.get("https://cdn.example.com/missing.jpg").mock(return_value=httpx.Response(404))

    with pytest.raises(ImageRenderError):
        await render_banner("Air Max 90", "https://cdn.example.com/missing.jpg", "7600")


@respx.mock
async def test_render_banner_raises_on_unparseable_image():
    respx.get("https://cdn.example.com/notanimage.jpg").mock(
        return_value=httpx.Response(200, content=b"not an image")
    )

    with pytest.raises(ImageRenderError):
        await render_banner("Air Max 90", "https://cdn.example.com/notanimage.jpg", "7600")


@pytest.mark.parametrize(
    "title,expected",
    [
        ("Nike Air Max 90", "Nike"),
        ("adidas Ultraboost 22", "Adidas"),
        ("PUMA Suede Classic", "Puma"),
        ("Under Armour HOVR Phantom", "Under Armour"),
        ("Under-Armour Curry Flow", "Under Armour"),
    ],
)
def test_detect_brand_matches_known_brands_case_insensitively(title, expected):
    assert detect_brand(title) == expected


def test_detect_brand_returns_none_for_unrecognized_brand():
    assert detect_brand("New Balance 990v6") is None


def test_detect_brand_does_not_match_substring_inside_another_word():
    # "Pumas" should not fire the Puma brand mark — \b keeps this a whole-word match.
    assert detect_brand("Pumas Energy Drink Cooler") is None


def _flat_background_photo() -> Image.Image:
    # A light-grey square (like a real catalog product photo's backdrop,
    # e.g. Under Armour's own bgc=f0f0f0) with a solid dark square "product"
    # in the middle, clearly distinct from the background color.
    img = Image.new("RGBA", (100, 100), (240, 240, 240, 255))
    for x in range(30, 70):
        for y in range(30, 70):
            img.putpixel((x, y), (10, 10, 10, 255))
    return img


def test_key_out_flat_background_makes_background_transparent():
    result = _key_out_flat_background(_flat_background_photo())
    # Corner (background) faded out...
    assert result.getpixel((0, 0))[3] < 50
    # ...center (the "product") stays opaque.
    assert result.getpixel((50, 50))[3] > 200


def test_key_out_flat_background_leaves_busy_photo_fully_opaque():
    # No uniform backdrop here — every pixel differs sharply from the
    # corner, so nothing beyond a trivial sliver should be keyed out. (The
    # corner pixel itself is, by definition, treated as "background" and
    # always fades — that's not what's under test here.)
    img = Image.new("RGBA", (100, 100), (0, 0, 0, 255))
    for x in range(100):
        for y in range(100):
            img.putpixel((x, y), ((x * 7) % 256, (y * 13) % 256, (x + y) % 256, 255))

    result = _key_out_flat_background(img)

    assert result.getpixel((50, 50))[3] == 255
    assert result.getpixel((99, 99))[3] == 255


@pytest.mark.parametrize(
    "title,expected",
    [
        ("Nike Pegasus Plus 2", "Nike Pegasus Plus 2"),  # already short — untouched
        ("Nike Air Zoom Pegasus Plus 2 Men's Road Running Shoes", "Nike Air Zoom Pegasus Plus 2"),
        ("Nike Air Max 90 - Men's Shoes", "Nike Air Max 90"),
        ("Nike Air Max 90 | Nike MY", "Nike Air Max 90"),
        ("Under Armour HOVR Phantom, Black/White, US 10", "Under Armour HOVR Phantom"),
        ("Puma Suede Classic Sneakers", "Puma Suede Classic"),
    ],
)
def test_simplify_title_drops_retailer_boilerplate(title, expected):
    assert _simplify_title(title) == expected


def test_simplify_title_falls_back_to_original_when_nothing_is_left():
    # A pathological title that's *only* boilerplate shouldn't simplify to
    # an empty string — keep whatever's left over the delimiter cut instead.
    assert _simplify_title("Shoes") == "Shoes"


def test_crop_to_opaque_bbox_removes_transparent_margin():
    # A product photo with generous blank margin around a small opaque
    # "product" square — after keying + cropping, the crop should hug the
    # opaque region rather than keep the surrounding transparent padding.
    img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    for x in range(80, 120):
        for y in range(80, 120):
            img.putpixel((x, y), (10, 10, 10, 255))

    result = _crop_to_opaque_bbox(img)

    assert result.size == (40, 40)


def test_crop_to_opaque_bbox_returns_original_when_fully_transparent():
    img = Image.new("RGBA", (50, 60), (0, 0, 0, 0))
    result = _crop_to_opaque_bbox(img)
    assert result.size == (50, 60)


def test_key_out_flat_background_never_increases_existing_transparency():
    # An image that already has real transparency somewhere (e.g. a proper
    # cutout PNG) should stay transparent there regardless of corner color.
    img = Image.new("RGBA", (100, 100), (240, 240, 240, 255))
    for x in range(30, 70):
        for y in range(30, 70):
            img.putpixel((x, y), (10, 10, 10, 0))  # already transparent

    result = _key_out_flat_background(img)

    assert result.getpixel((50, 50))[3] == 0
