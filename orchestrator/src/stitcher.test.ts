import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { stitch, solidPng } from "./stitcher";

describe("stitch", () => {
  it("places tiles at their offsets", () => {
    const red = solidPng(2, 2, [255, 0, 0, 255]);
    const blue = solidPng(2, 2, [0, 0, 255, 255]);
    const out = stitch(
      [
        { png: red, ox: 0, oy: 0 },
        { png: blue, ox: 2, oy: 0 },
      ],
      4,
      2
    );
    const img = PNG.sync.read(out);
    expect(img.width).toBe(4);
    expect(img.height).toBe(2);
    const px = (x: number, y: number) => {
      const i = (img.width * y + x) << 2;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    expect(px(0, 0)).toEqual([255, 0, 0]);
    expect(px(3, 0)).toEqual([0, 0, 255]);
  });
});
