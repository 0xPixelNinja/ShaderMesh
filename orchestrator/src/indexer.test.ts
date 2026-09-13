import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { ProjectionStore } from "./store";
import { dispatch } from "./indexer";

describe("dispatch", () => {
  it("applies chain events to the store and forwards them", () => {
    const store = new ProjectionStore();
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on("update", (u: { name: string }) => seen.push(u.name));

    dispatch(store, "JobPosted", { jobId: 1n, requester: "0xR", inputCID: "local://m", taskCount: 2n, rewardPerTask: 100n }, emitter);
    expect(store.getJob(1)!.taskCount).toBe(2);
    expect(store.getJob(1)!.rewardPerTask).toBe("100");

    dispatch(store, "TaskClaimed", { jobId: 1n, index: 0n, provider: "0xP" }, emitter);
    expect(store.getTask(1, 0)!.status).toBe("Claimed");

    dispatch(store, "ResultSubmitted", { jobId: 1n, index: 0n, provider: "0xP", resultHash: "0xhash", outputCID: "local://o" }, emitter);
    expect(store.getTask(1, 0)!.status).toBe("Submitted");

    dispatch(store, "TaskPaid", { jobId: 1n, index: 0n }, emitter);
    expect(store.getTask(1, 0)!.status).toBe("Paid");

    expect(seen).toContain("JobPosted");
    expect(seen).toContain("TaskPaid");
  });
});
