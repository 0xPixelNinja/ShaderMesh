import { describe, it, expect } from "vitest";
import { ProjectionStore } from "./store";

describe("ProjectionStore", () => {
  it("tracks a job through its lifecycle", () => {
    const s = new ProjectionStore();
    s.onJobPosted(1, "0xReq", "local://m", 2, "100");
    expect(s.getJob(1)!.taskCount).toBe(2);
    expect(s.listTasks(1).length).toBe(2);

    s.onTaskClaimed(1, 0, "0xP1");
    expect(s.getTask(1, 0)!.status).toBe("Claimed");

    s.onResultSubmitted(1, 0, "0xP1", "0xhash", "local://o0");
    expect(s.getTask(1, 0)!.status).toBe("Submitted");

    s.onTaskPaid(1, 0);
    expect(s.getTask(1, 0)!.status).toBe("Paid");
    expect(s.getJob(1)!.completedTasks).toBe(1);

    s.onTaskClaimed(1, 1, "0xP2");
    s.onResultSubmitted(1, 1, "0xP2", "0xh", "local://o1");
    s.onDisputeOpened(1, 1);
    expect(s.getTask(1, 1)!.status).toBe("Disputed");

    s.onTaskReopened(1, 1);
    expect(s.getTask(1, 1)!.status).toBe("Open");
    expect(s.getTask(1, 1)!.provider).toBeNull();

    s.onJobCompleted(1);
    expect(s.getJob(1)!.completed).toBe(true);
  });
});
