#!/usr/bin/env python3
"""Generates the Open Graph / Twitter Card preview image from assets/brand/.

Usage: python3 scripts/make-og-image.py [OUT] [--social] [--font PATH] [--font-regular PATH]
       (default OUT: web/public/og-image.png, or assets/brand/social-preview.png with --social)

The image is 1200x630: the kTone banner on the brand background with a short
Russian tagline. With --social it is the GitHub repository social preview
instead: 1280x640 with an English tagline (upload it in the repository
Settings, General, Social preview; GitHub has no API for it). The tagline needs a sans-serif font with Cyrillic glyphs; by
default the first of FONT_CANDIDATES that exists is used (DejaVu Sans or Noto
Sans, packaged as fonts-dejavu-core / fonts-noto-core on Debian and Ubuntu).
Requires Pillow.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"
DEFAULT_OUT = ROOT / "web" / "public" / "og-image.png"
SOCIAL_OUT = BRAND / "social-preview.png"

SIZE = (1200, 630)
SOCIAL_SIZE = (1280, 640)
# Same background as the app icon and the manifest theme color.
BACKGROUND = (30, 11, 73)
TEXT = (255, 255, 255)
MUTED = (196, 188, 226)

TITLE = "Тюнер для голоса"
SUBTITLE = "Нота, центы и тональность в реальном времени"
SOCIAL_TITLE = "Pitch detector for singers"
SOCIAL_SUBTITLE = "Note, cents and key-aware notation in real time"

FONT_DIRS = (
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/noto",
    "/usr/share/fonts/dejavu",
    "/usr/share/fonts/noto",
    "/Library/Fonts",
    "C:/Windows/Fonts",
)
BOLD_CANDIDATES = ("DejaVuSans-Bold.ttf", "NotoSans-Bold.ttf", "arialbd.ttf")
REGULAR_CANDIDATES = ("DejaVuSans.ttf", "NotoSans-Regular.ttf", "arial.ttf")


def find_font(names: tuple[str, ...]) -> str:
    for directory in FONT_DIRS:
        for name in names:
            path = Path(directory) / name
            if path.exists():
                return str(path)
    raise SystemExit(f"No font with Cyrillic found ({', '.join(names)}); pass --font")


def trim(img: Image.Image) -> Image.Image:
    """Crops transparent margins (alpha below 16 counts as transparent)."""
    mask = img.getchannel("A").point(lambda a: 255 if a > 16 else 0)
    return img.crop(mask.getbbox())


def centered_text(draw: ImageDraw.ImageDraw, width: int, y: int, text: str, font, fill) -> int:
    """Draws `text` horizontally centered with its top at `y`; returns its bottom."""
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (right - left)) // 2 - left, y - top), text, font=font, fill=fill)
    return y + bottom - top


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", nargs="?", type=Path)
    parser.add_argument("--social", action="store_true", help="GitHub social preview (1280x640, English)")
    parser.add_argument("--font", help="bold TTF/OTF with Cyrillic for the title")
    parser.add_argument("--font-regular", help="regular TTF/OTF with Cyrillic for the subtitle")
    args = parser.parse_args()

    bold = ImageFont.truetype(args.font or find_font(BOLD_CANDIDATES), 64)
    regular = ImageFont.truetype(args.font_regular or find_font(REGULAR_CANDIDATES), 36)

    size, title, subtitle = (
        (SOCIAL_SIZE, SOCIAL_TITLE, SOCIAL_SUBTITLE) if args.social else (SIZE, TITLE, SUBTITLE)
    )
    out = args.out or (SOCIAL_OUT if args.social else DEFAULT_OUT)

    canvas = Image.new("RGB", size, BACKGROUND)
    banner = trim(Image.open(BRAND / "banner.png").convert("RGBA"))
    width = 900
    banner = banner.resize((width, round(banner.height * width / banner.width)), Image.LANCZOS)
    top = 122
    canvas.paste(banner, ((size[0] - width) // 2, top), banner)

    draw = ImageDraw.Draw(canvas)
    y = centered_text(draw, size[0], top + banner.height + 70, title, bold, TEXT)
    centered_text(draw, size[0], y + 28, subtitle, regular, MUTED)

    # A palette keeps the flat-color image small (well under 150 KB).
    canvas.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
        out, optimize=True
    )
    print(out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
