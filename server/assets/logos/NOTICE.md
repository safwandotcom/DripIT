# Brand logo assets

`nike.png`, `adidas.png`, `puma.png`, and `under_armour.png` are trademarks
of their respective owners (Nike, Inc.; adidas AG; PUMA SE; Under Armour,
Inc.). They're sourced from Wikimedia Commons' public-domain-shape / simple
geometric-mark renditions of each company's logo and vendored here so
`image_engine.py` can stamp the correct brand mark onto a listing without a
live fetch from each brand's own site on every render (same rationale as
the vendored fonts in `assets/fonts/`: reliability, no external dependency
at request time). Usage here is to identify which brand a resold item is
from — the same purpose any sneaker resale listing uses a brand logo for —
not to imply endorsement by the brand.

If a given brand objects to this usage, remove the corresponding file and
`_BRAND_LOGOS` entry in `image_engine.py`; the banner falls back to no
brand mark for that product.
