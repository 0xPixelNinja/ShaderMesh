import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { ProjectionStore } from "./store";
import { LocalDirStorage } from "./storage";
import { JobService } from "./jobservice";
import { solidPng } from "./stitcher";

const spec = { re_min: -2, re_max: 1, im_min: -1.5, im_max: 1.5, max_iter: 40 };

describe("JobService", () => {
  it("prepares a job manifest and pins it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-"));
    const store = new ProjectionStore();
    const storage = new LocalDirStorage(join(dir, "store"));
    const svc = new JobService(storage, store);

    const prep = await svc.prepare({ width: 32, height: 32, ...spec }, 2, 2);
    expect(prep.taskCount).toBe(4);
    expect(prep.inputCID.startsWith("local://")).toBe(true);

    const back = JSON.parse((await storage.get(prep.inputCID)).toString());
    expect(back.tasks.length).toBe(4);
  });

  it("stitches submitted tiles into a full image", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-"));
    const store = new ProjectionStore();
    const storage = new LocalDirStorage(join(dir, "store"));
    const svc = new JobService(storage, store);

    const prep = await svc.prepare({ width: 4, height: 2, ...spec }, 2, 1);
    store.onJobPosted(1, "0xReq", prep.inputCID, prep.taskCount, "100");

    const colors: [number, number, number, number][] = [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ];
    for (let i = 0; i < prep.manifest.tasks.length; i++) {
      const t = prep.manifest.tasks[i];
      const png = solidPng(t.width, t.height, colors[i]);
      const cid = await storage.put(png);
      store.onTaskClaimed(1, i, "0xP");
      store.onResultSubmitted(1, i, "0xP", "0xhash", cid);
    }

    const resultCID = await svc.stitchJob(1);
    const img = PNG.sync.read(await storage.get(resultCID));
    expect(img.width).toBe(4);
    expect(img.height).toBe(2);
    const px = (x: number, y: number) => {
      const i = (img.width * y + x) << 2;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    expect(px(0, 0)).toEqual([255, 0, 0]);
    expect(px(3, 0)).toEqual([0, 0, 255]);
    expect(store.getJob(1)!.resultCID).toBe(resultCID);
  });
});
