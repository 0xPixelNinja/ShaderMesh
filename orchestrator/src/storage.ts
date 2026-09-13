import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Content addressed storage. The identifier is derived from the content so it is
 * a stable reference to the exact bytes. Mirrors the agent's storage so a
 * manifest or output written by one can be read by the other in the local stack.
 */
export interface Storage {
  put(data: Buffer): Promise<string>;
  get(cid: string): Promise<Buffer>;
}

export class LocalDirStorage implements Storage {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
  }

  async put(data: Buffer): Promise<string> {
    const key = createHash("sha256").update(data).digest("hex");
    writeFileSync(join(this.root, key), data);
    return `local://${key}`;
  }

  async get(cid: string): Promise<Buffer> {
    const key = cid.split("://")[1] ?? cid;
    return readFileSync(join(this.root, key));
  }
}

export class IpfsStorage implements Storage {
  constructor(private apiUrl: string) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
  }

  async put(data: Buffer): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)]));
    const res = await fetch(`${this.apiUrl}/api/v0/add`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`ipfs add failed: ${res.status}`);
    const json = (await res.json()) as { Hash: string };
    return `ipfs://${json.Hash}`;
  }

  async get(cid: string): Promise<Buffer> {
    const hash = cid.split("://")[1] ?? cid;
    const res = await fetch(`${this.apiUrl}/api/v0/cat?arg=${hash}`, { method: "POST" });
    if (!res.ok) throw new Error(`ipfs cat failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export function makeStorage(
  backend: string,
  opts: { root?: string; ipfsApiUrl?: string } = {}
): Storage {
  if (backend === "ipfs") {
    return new IpfsStorage(opts.ipfsApiUrl ?? "http://127.0.0.1:5001");
  }
  return new LocalDirStorage(opts.root ?? "./data");
}
