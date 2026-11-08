#!/usr/bin/env python3
"""Generates app icons from the brand sources in assets/brand/.

Usage: python3 scripts/make-icons.py [OUT_DIR]   (default: web/public/icons)
Requires Pillow.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "web" / "public" / "icons"

# Background of the rounded app icon, sampled from assets/brand/icon.png.
BACKGROUND = (30, 11, 73, 255)


def trim(img: Image.Image) -> Image.Image:
    """Crops transparent margins (alpha below 16 counts as transparent)."""
    mask = img.getchannel("A").point(lambda a: 255 if a > 16 else 0)
    return img.crop(mask.getbbox())


def square(img: Image.Image, pad: float = 0.0) -> Image.Image:
    """Centers `img` on a transparent square canvas with `pad` relative margin."""
    side = round(max(img.size) * (1 + 2 * pad))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return canvas


def full_bleed(symbol: Image.Image, size: int, symbol_width: float) -> Image.Image:
    """Symbol on a solid square background (maskable / Apple touch icons)."""
    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    width = round(size * symbol_width)
    height = round(symbol.height * width / symbol.width)
    scaled = symbol.resize((width, height), Image.LANCZOS)
    canvas.paste(scaled, ((size - width) // 2, (size - height) // 2), scaled)
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = square(trim(Image.open(BRAND / "icon.png").convert("RGBA")), pad=0.01)
    symbol = trim(Image.open(BRAND / "symbol.png").convert("RGBA"))

    for size in (512, 192):
        icon.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
    # Maskable icons: content must stay inside the central 80% circle.
    for size in (512, 192):
        full_bleed(symbol, size, 0.62).save(OUT / f"maskable-{size}.png", optimize=True)
    # iOS rounds the corners itself and ignores transparency.
    full_bleed(symbol, 180, 0.66).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)

    icon.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png", optimize=True)
    icon.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    banner = trim(Image.open(BRAND / "banner.png").convert("RGBA"))
    banner.thumbnail((1200, 1200), Image.LANCZOS)
    banner.save(BRAND / "banner-readme.png", optimize=True)

    for path in sorted(OUT.iterdir()):
        print(path)


if __name__ == "__main__":
    main()
