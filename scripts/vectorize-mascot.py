"""Quantize the ImageGen mascot to the Recipeboy palette and trace it to SVG."""

from pathlib import Path
import re

from PIL import Image
import vtracer


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "recipeboy-mascot-source.png"
FLAT = ROOT / "assets" / "recipeboy-mascot-flat.png"
OUTPUT = ROOT / "assets" / "recipeboy-mascot.svg"

PALETTE = (
    (16, 42, 90),    # navy
    (255, 241, 184), # cream
    (239, 51, 64),   # red
    (25, 92, 203),   # blue
    (101, 184, 74),  # green
)


def nearest_color(red: int, green: int, blue: int) -> tuple[int, int, int]:
    return min(
        PALETTE,
        key=lambda color: sum((channel - target) ** 2 for channel, target in zip((red, green, blue), color)),
    )


def quantize() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    pixels = []
    for red, green, blue, alpha in image.get_flattened_data():
        if alpha < 96:
            pixels.append((0, 0, 0, 0))
        else:
            pixels.append((*nearest_color(red, green, blue), 255))
    image.putdata(pixels)
    image.save(FLAT, optimize=True)


def trace() -> None:
    vtracer.convert_image_to_svg_py(
        str(FLAT),
        str(OUTPUT),
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=8,
        color_precision=8,
        layer_difference=8,
        corner_threshold=60,
        length_threshold=5,
        max_iterations=10,
        splice_threshold=45,
        path_precision=2,
    )
    svg = OUTPUT.read_text(encoding="utf-8")

    def lock_palette(match: re.Match[str]) -> str:
        value = match.group(0)
        red, green, blue = (int(value[index:index + 2], 16) for index in (1, 3, 5))
        return "#" + "".join(f"{channel:02X}" for channel in nearest_color(red, green, blue))

    OUTPUT.write_text(re.sub(r"#[0-9A-Fa-f]{6}", lock_palette, svg), encoding="utf-8")


if __name__ == "__main__":
    quantize()
    trace()
    print(f"Vectorized {SOURCE.name} -> {OUTPUT.name}")
