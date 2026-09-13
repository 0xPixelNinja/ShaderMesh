import { ImageSpec, JobManifest, splitDeterministic } from "./splitter";
import { stitch, Tile } from "./stitcher";
import { ProjectionStore } from "./store";
import { Storage } from "./storage";

export interface PreparedJob {
  inputCID: string;
  taskCount: number;
  manifest: JobManifest;
}

/**
 * Ties splitting, storage, and stitching together.
 *
 * `prepare` runs before a job is posted: it splits the image, pins the manifest,
 * and returns the input CID and task count for the requester to post with their
 * wallet. Pinning content is not custody, so this stays within the untrusted
 * coordinator's remit. `stitchJob` runs after all tasks settle.
 */
export class JobService {
  constructor(private storage: Storage, private store: ProjectionStore) {}

  async prepare(spec: ImageSpec, tilesX: number, tilesY: number): Promise<PreparedJob> {
    const manifest = splitDeterministic(spec, tilesX, tilesY);
    const inputCID = await this.storage.put(Buffer.from(JSON.stringify(manifest)));
    return { inputCID, taskCount: manifest.tasks.length, manifest };
  }

  async stitchJob(jobId: number): Promise<string> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);

    const manifest = JSON.parse((await this.storage.get(job.inputCID)).toString()) as JobManifest;
    const tiles: Tile[] = [];
    for (let i = 0; i < manifest.tasks.length; i++) {
      const rec = this.store.getTask(jobId, i);
      if (!rec || !rec.outputCID) throw new Error(`task ${i} not ready for stitch`);
      const png = await this.storage.get(rec.outputCID);
      tiles.push({ png, ox: manifest.tasks[i].ox, oy: manifest.tasks[i].oy });
    }

    const result = stitch(tiles, manifest.image.width, manifest.image.height);
    const resultCID = await this.storage.put(result);
    this.store.setJobResult(jobId, resultCID);
    return resultCID;
  }
}
