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
    _resize_to_fit,
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
    # No uniform backdrop here, and — unlike a smooth gradient — no gradual
    # path from any border pixel to the interior either: neighboring pixels
    # jump sharply in every direction, the way a real textured/patterned
    # background (fabric, a printed backdrop) would. The border-walking
    # keyer must not find some accidental smooth route through pixels that
    # merely happen to be far from a single fixed corner sample. (Every
    # border pixel is, by definition, a seed the keyer walks inward from
    # and always fades — that's not what's under test here, so both sample
    # points stay a few pixels clear of the border.)
    img = Image.new("RGBA", (100, 100), (0, 0, 0, 255))
    for x in range(100):
        for y in range(100):
            h = (x * 92821) ^ (y * 68917) ^ ((x + y) * 2654435761)
            img.putpixel((x, y), (h & 0xFF, (h >> 8) & 0xFF, (h >> 16) & 0xFF, 255))

    result = _key_out_flat_background(img)

    assert result.getpixel((50, 50))[3] == 255
    assert result.getpixel((90, 90))[3] == 255


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


def test_resize_to_fit_enlarges_a_small_image_to_fill_the_box():
    # The real bug: a product photo cropped tight to its own silhouette is
    # often smaller than the banner's photo frame. Image.thumbnail() (the
    # old approach) only ever shrinks, leaving a small source image small —
    # _resize_to_fit must scale it UP to actually fill the given box.
    img = Image.new("RGBA", (200, 100), (10, 10, 10, 255))  # 2:1, smaller than the box
    result = _resize_to_fit(img, 800, 500)
    # Width-bound: 800/200 = 4.0 scale (400 > 500 stays within height budget)
    assert result.size == (800, 400)


def test_resize_to_fit_still_shrinks_an_oversized_image():
    img = Image.new("RGBA", (2000, 1000), (10, 10, 10, 255))
    result = _resize_to_fit(img, 800, 500)
    assert result.size == (800, 400)


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
