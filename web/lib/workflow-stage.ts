export function nextWorkflowStage(stage: number, key: string, count: number) {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const direction = key === "ArrowRight" ? 1 : -1;
  return (stage + direction + count) % count;
}
