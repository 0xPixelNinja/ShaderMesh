/**
 * Job splitting for the deterministic Mandelbrot workload.
 *
 * A full image is divided into a grid of tiles. Each tile's pixel rectangle and
 * matching complex plane subregion are computed so that rendering the tiles and
 * stitching them reproduces the full image exactly. Extra placement keys (ox, oy)
 * are ignored by the render job and used only by the stitcher.
 */

export interface RegionSpec {
  re_min: number;
  re_max: number;
  im_min: number;
  im_max: number;
  max_iter: number;
}

export interface ImageSpec extends RegionSpec {
  width: number;
  height: number;
}

export interface TaskManifest extends RegionSpec {
  width: number;
  height: number;
  ox: number;
  oy: number;
  tile_x: number;
  tile_y: number;
}

export interface JobManifest {
  job: "deterministic";
  image: { width: number; height: number };
  tasks: TaskManifest[];
}

export function splitDeterministic(
  spec: ImageSpec,
  tilesX: number,
  tilesY: number
): JobManifest {
  if (tilesX < 1 || tilesY < 1) throw new Error("tilesX and tilesY must be >= 1");

  const dre = (spec.re_max - spec.re_min) / spec.width;
  const dim = (spec.im_max - spec.im_min) / spec.height;

  const tasks: TaskManifest[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    const oy = Math.floor((ty * spec.height) / tilesY);
    const oy2 = Math.floor(((ty + 1) * spec.height) / tilesY);
    const th = oy2 - oy;
    for (let tx = 0; tx < tilesX; tx++) {
      const ox = Math.floor((tx * spec.width) / tilesX);
      const ox2 = Math.floor(((tx + 1) * spec.width) / tilesX);
      const tw = ox2 - ox;
      tasks.push({
        width: tw,
        height: th,
        re_min: spec.re_min + ox * dre,
        re_max: spec.re_min + ox2 * dre,
        im_min: spec.im_min + oy * dim,
        im_max: spec.im_min + oy2 * dim,
        max_iter: spec.max_iter,
        ox,
        oy,
        tile_x: tx,
        tile_y: ty,
      });
    }
  }

  return { job: "deterministic", image: { width: spec.width, height: spec.height }, tasks };
}
