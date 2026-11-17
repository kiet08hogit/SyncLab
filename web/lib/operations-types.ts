export interface OperationsSnapshot {
  collectedAt: string;
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    pausedJobs: number;
    waitingChildren: number;
    paused: boolean;
  }>;
  sandbox: {
    count: number;
    failed: number;
    totalSeconds: number;
    buckets: Array<{ le: number; count: number }>;
  };
  tokens: { input: number; output: number };
}
