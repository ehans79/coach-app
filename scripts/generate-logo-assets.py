#!/usr/bin/env python3
"""Regenerates every derived logo asset from the two source files in public/.

    pip install Pillow && python3 scripts/generate-logo-assets.py

Not part of the Node toolchain — this runs by hand when the logo changes, and
exists so the derived sizes are reproducible rather than a set of committed
binaries nobody knows how to remake.

Why this isn't just a resize: in both sources the mark sits off-centre in a
1024x1024 canvas, occupying about 528x454 in the middle-right. Scaling the raw
canvas to 32px would yield a tiny mark floating off-centre. So every asset is
built the same way — trim to the mark's real bounding box, then re-centre it on
a fresh canvas at a content fraction chosen for that asset's job:

  * framed icons (favicon, apple, manifest) get a white card, per the brief's
    "logo-icon.jpg for anything with its own icon frame";
  * maskable gets much more padding, because Android crops icons to a circle of
    80% diameter and anything outside that safe zone is cut off;
  * inline marks (nav, email) are trimmed tight with no padding at all — their
    spacing is CSS's job, not the bitmap's, and baked-in padding would fight it.
"""

from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
ICON_SRC = ROOT / "public" / "logo-icon.jpg"      # square, white card background
MARK_SRC = ROOT / "public" / "logo-mark.png"      # same mark, transparent

WHITE = (255, 255, 255)
# Ignores JPEG ringing around the mark's edges when finding the bounding box.
WHITE_TOLERANCE = 12


def trim_to_mark(path: Path) -> Image.Image:
    """The mark alone, cropped to its true bounds. RGBA either way."""
    im = Image.open(path)
    if im.mode in ("RGBA", "LA"):
        im = im.convert("RGBA")
        box = im.getchannel("A").getbbox()
    else:
        im = im.convert("RGB")
        diff = ImageChops.difference(im, Image.new("RGB", im.size, WHITE)).convert("L")
        box = diff.point(lambda v: 255 if v > WHITE_TOLERANCE else 0).getbbox()
        im = im.convert("RGBA")
    if box is None:
        raise SystemExit(f"{path.name}: found no mark to trim — is the file blank?")
    return im.crop(box)


def square(mark: Image.Image, size: int, content: float, background) -> Image.Image:
    """The mark centred on a square canvas, scaled so its longest side is
    `content` of the canvas. Fitting the LONGEST side is what keeps a
    non-square mark inside the frame in both axes."""
    target = size * content
    scale = target / max(mark.size)
    w, h = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(mark.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return canvas


def by_height(mark: Image.Image, height: int) -> Image.Image:
    """Trimmed mark at an exact pixel height, aspect preserved — for inline use."""
    width = max(1, round(mark.width * (height / mark.height)))
    return mark.resize((width, height), Image.LANCZOS)


def save(im: Image.Image, path: Path, **kw) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, **kw)
    print(f"  {path.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  {path.stat().st_size:,}B")


def main() -> None:
    icon_mark = trim_to_mark(ICON_SRC)
    flat_mark = trim_to_mark(MARK_SRC)
    print(f"trimmed logo-icon.jpg -> {icon_mark.size}")
    print(f"trimmed logo-mark.png -> {flat_mark.size}\n")

    # --- Framed icons, white card ---------------------------------------------
    print("browser + home-screen icons:")
    # Each ICO frame is rendered from the full-resolution source rather than by
    # letting Pillow downscale one master, so the 16px frame stays legible.
    # Generous content fraction: at 16px, margin is wasted pixels.
    # Frames stay RGBA (opaque white, not flattened to RGB): Pillow stores the
    # larger ones as embedded PNGs, and Next's ICO decoder rejects a non-RGBA
    # PNG inside an ICO outright — "The PNG is not in RGBA format!".
    ico_sizes = [16, 32, 48, 256]
    frames = [square(icon_mark, s, 0.88, WHITE) for s in ico_sizes]
    frames[-1].save(
        ROOT / "src" / "app" / "favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
        append_images=frames[:-1],
    )
    ico = ROOT / "src" / "app" / "favicon.ico"
    print(f"  {ico.relative_to(ROOT)}  {'/'.join(str(s) for s in ico_sizes)}  {ico.stat().st_size:,}B")

    # iOS home screen. Opaque by convention — iOS composites onto black otherwise.
    save(square(icon_mark, 180, 0.80, WHITE).convert("RGB"),
         ROOT / "src" / "app" / "apple-icon.png", format="PNG", optimize=True)

    for size in (192, 512):
        save(square(icon_mark, size, 0.82, WHITE).convert("RGB"),
             ROOT / "public" / f"icon-{size}.png", format="PNG", optimize=True)

    # Maskable: Android may crop to a circle of 80% diameter, so the mark has to
    # sit well inside that or it loses its edges on a home screen.
    save(square(icon_mark, 512, 0.62, WHITE).convert("RGB"),
         ROOT / "public" / "icon-maskable-512.png", format="PNG", optimize=True)

    # --- Inline marks, transparent --------------------------------------------
    print("\ninline marks (2x for retina, displayed at half these heights):")
    save(by_height(flat_mark, 64), ROOT / "public" / "logo-mark-64.png",
         format="PNG", optimize=True)   # nav, rendered at 32px tall
    save(by_height(flat_mark, 56), ROOT / "public" / "logo-mark-email.png",
         format="PNG", optimize=True)   # email header, rendered at 28px tall


if __name__ == "__main__":
    main()
