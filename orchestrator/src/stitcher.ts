import { PNG } from "pngjs";

export interface Tile {
  png: Buffer;
  ox: number;
  oy: number;
}

/**
 * Compose tiles into a single image by blitting each tile's pixels at its offset.
 * Returns encoded PNG bytes.
 */
export function stitch(tiles: Tile[], width: number, height: number): Buffer {
  const out = new PNG({ width, height });
  for (const tile of tiles) {
    const src = PNG.sync.read(tile.png);
    for (let y = 0; y < src.height; y++) {
      const dy = tile.oy + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < src.width; x++) {
        const dx = tile.ox + x;
        if (dx < 0 || dx >= width) continue;
        const si = (src.width * y + x) << 2;
        const di = (width * dy + dx) << 2;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = src.data[si + 3];
      }
    }
  }
  return PNG.sync.write(out);
}

/** Helper to build a solid RGBA PNG, used in tests and placeholders. */
export function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i << 2;
    png.data[o] = rgba[0];
    png.data[o + 1] = rgba[1];
    png.data[o + 2] = rgba[2];
    png.data[o + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}
