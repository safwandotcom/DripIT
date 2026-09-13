import io

import httpx
import pytest
import respx
from PIL import Image

from image_engine import CANVAS_SIZE, ImageRenderError, render_banner


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
