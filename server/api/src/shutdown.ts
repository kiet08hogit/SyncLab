/**
 * process.on expects a synchronous listener. An async listener turns a failed
 * app.close() into an unhandled rejection and skips process.exit, so a worker
 * can keep its queue connection after SIGTERM.
 */
export function onProcessSignal(
  close: () => Promise<void>,
  exit: (code: number) => void,
): () => void {
  return () => {
    void close().then(
      () => exit(0),
      () => exit(1),
    );
  };
}
