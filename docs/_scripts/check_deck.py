"""Check the generated deck for font, bounds and overlap defects.

Catches the failures that are easy to miss by eye: a run left on the theme font,
a shape pushed past the slide edge, and two blocks of text sitting on top of each
other.

    python docs/_scripts/check_deck.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from pptx import Presentation
from pptx.util import Emu

DECK = Path(__file__).resolve().parent.parent / "ShaderMesh-Presentation.pptx"
ALLOWED_FONTS = {"Segoe UI", "Consolas"}


def rect(shape):
    return shape.left, shape.top, shape.left + shape.width, shape.top + shape.height


def overlap_area(a, b) -> int:
    dx = min(a[2], b[2]) - max(a[0], b[0])
    dy = min(a[3], b[3]) - max(a[1], b[1])
    return dx * dy if dx > 0 and dy > 0 else 0


def main() -> int:
    prs = Presentation(str(DECK))
    sw, sh = prs.slide_width, prs.slide_height
    problems: list[str] = []

    for index, slide in enumerate(prs.slides, start=1):
        text_shapes = []

        for shape in slide.shapes:
            left, top, right, bottom = rect(shape)
            # A full-bleed background rectangle is expected to match the slide.
            is_background = left == 0 and top == 0 and shape.width == sw and shape.height == sh
            if not is_background and (left < 0 or top < 0 or right > sw or bottom > sh):
                problems.append(
                    f"slide {index}: '{shape.shape_type}' extends outside the slide "
                    f"({Emu(right).inches:.2f}in x {Emu(bottom).inches:.2f}in)"
                )

            if not shape.has_text_frame:
                continue

            content = shape.text_frame.text.strip()
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    name = run.font.name
                    if name is None:
                        problems.append(
                            f"slide {index}: run '{run.text[:38]}' has no explicit font"
                        )
                    elif name not in ALLOWED_FONTS:
                        problems.append(
                            f"slide {index}: run '{run.text[:38]}' uses '{name}'"
                        )
            if content:
                text_shapes.append((content, rect(shape)))

        for i in range(len(text_shapes)):
            for j in range(i + 1, len(text_shapes)):
                a_text, a_rect = text_shapes[i]
                b_text, b_rect = text_shapes[j]
                area = overlap_area(a_rect, b_rect)
                if area <= 0:
                    continue
                smaller = min(
                    (a_rect[2] - a_rect[0]) * (a_rect[3] - a_rect[1]),
                    (b_rect[2] - b_rect[0]) * (b_rect[3] - b_rect[1]),
                )
                # Small shapes such as numbered badges sit inside a row on purpose.
                if smaller and area / smaller > 0.25:
                    problems.append(
                        f"slide {index}: text overlap {area / smaller:.0%} between "
                        f"'{a_text[:28]}' and '{b_text[:28]}'"
                    )

    if problems:
        print(f"{len(problems)} problem(s):")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(f"deck OK: {len(prs.slides._sldIdLst)} slides, fonts {sorted(ALLOWED_FONTS)}, no overlaps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
