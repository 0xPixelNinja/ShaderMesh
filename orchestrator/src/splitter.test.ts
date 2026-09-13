import { describe, it, expect } from "vitest";
import { splitDeterministic, ImageSpec } from "./splitter";

const spec: ImageSpec = {
  width: 64,
  height: 64,
  re_min: -2,
  re_max: 1,
  im_min: -1.5,
  im_max: 1.5,
  max_iter: 50,
};

describe("splitDeterministic", () => {
  it("produces tilesX * tilesY tasks", () => {
    const m = splitDeterministic(spec, 2, 2);
    expect(m.tasks.length).toBe(4);
    expect(m.image).toEqual({ width: 64, height: 64 });
  });

  it("tiles cover the pixel grid exactly", () => {
    const m = splitDeterministic(spec, 4, 2);
    let area = 0;
    for (const t of m.tasks) area += t.width * t.height;
    expect(area).toBe(64 * 64);

    const first = m.tasks.find((t) => t.tile_x === 0 && t.tile_y === 0)!;
    expect(first.ox).toBe(0);
    expect(first.oy).toBe(0);
    expect(first.re_min).toBeCloseTo(-2, 10);

    const last = m.tasks.find((t) => t.tile_x === 3 && t.tile_y === 1)!;
    expect(last.ox + last.width).toBe(64);
    expect(last.oy + last.height).toBe(64);
    expect(last.re_max).toBeCloseTo(1, 10);
    expect(last.im_max).toBeCloseTo(1.5, 10);
  });

  it("preserves the pixel-to-complex mapping across tiles", () => {
    const m = splitDeterministic(spec, 2, 1);
    const fullDre = (spec.re_max - spec.re_min) / spec.width;
    for (const t of m.tasks) {
      const tileDre = (t.re_max - t.re_min) / t.width;
      expect(tileDre).toBeCloseTo(fullDre, 12);
    }
  });
});
