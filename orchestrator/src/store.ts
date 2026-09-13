/**
 * In-memory projection of on-chain state. It is a derived, rebuildable view of
 * the chain (the source of truth), updated by replaying and subscribing to
 * events. Postgres persistence is a follow-up; the projection replays from chain
 * history on startup, which satisfies the rebuildable requirement.
 */

export type TaskStatus = "Open" | "Claimed" | "Submitted" | "Disputed" | "Paid";

export interface TaskRecord {
  jobId: number;
  index: number;
  provider: string | null;
  status: TaskStatus;
  resultHash: string | null;
  outputCID: string | null;
}

export interface JobRecord {
  id: number;
  requester: string;
  inputCID: string;
  taskCount: number;
  rewardPerTask: string;
  completedTasks: number;
  completed: boolean;
  resultCID: string | null;
}

export class ProjectionStore {
  readonly jobs = new Map<number, JobRecord>();
  readonly tasks = new Map<string, TaskRecord>();

  private key(jobId: number, index: number): string {
    return `${jobId}:${index}`;
  }

  onJobPosted(id: number, requester: string, inputCID: string, taskCount: number, rewardPerTask: string): void {
    this.jobs.set(id, {
      id,
      requester,
      inputCID,
      taskCount,
      rewardPerTask,
      completedTasks: 0,
      completed: false,
      resultCID: null,
    });
    for (let i = 0; i < taskCount; i++) {
      this.tasks.set(this.key(id, i), {
        jobId: id,
        index: i,
        provider: null,
        status: "Open",
        resultHash: null,
        outputCID: null,
      });
    }
  }

  onTaskClaimed(id: number, index: number, provider: string): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) {
      t.provider = provider;
      t.status = "Claimed";
    }
  }

  onResultSubmitted(id: number, index: number, provider: string, resultHash: string, outputCID: string): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) {
      t.provider = provider;
      t.resultHash = resultHash;
      t.outputCID = outputCID;
      t.status = "Submitted";
    }
  }

  onDisputeOpened(id: number, index: number): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) t.status = "Disputed";
  }

  onTaskPaid(id: number, index: number): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) t.status = "Paid";
    const j = this.jobs.get(id);
    if (j) j.completedTasks += 1;
  }

  onTaskReopened(id: number, index: number): void {
    const t = this.tasks.get(this.key(id, index));
    if (t) {
      t.status = "Open";
      t.provider = null;
      t.resultHash = null;
      t.outputCID = null;
    }
  }

  onJobCompleted(id: number): void {
    const j = this.jobs.get(id);
    if (j) j.completed = true;
  }

  setJobResult(id: number, resultCID: string): void {
    const j = this.jobs.get(id);
    if (j) j.resultCID = resultCID;
  }

  getJob(id: number): JobRecord | null {
    return this.jobs.get(id) ?? null;
  }

  listJobs(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => a.id - b.id);
  }

  getTask(id: number, index: number): TaskRecord | null {
    return this.tasks.get(this.key(id, index)) ?? null;
  }

  listTasks(jobId: number): TaskRecord[] {
    return [...this.tasks.values()]
      .filter((t) => t.jobId === jobId)
      .sort((a, b) => a.index - b.index);
  }
}
