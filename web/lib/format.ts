const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) {
      return relative.format(Math.round(diff / size), unit);
    }
  }
  return "just now";
}

const absolute = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return `${absolute.format(new Date(iso))} UTC`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

/** The worker prefixes command output with `[exit N]`; split it back out. */
export function splitExitCode(output: string | null): { exitCode: number | null; body: string } {
  const match = output?.match(/^\[exit (-?\d+)\]\n?/);
  if (!output || !match) return { exitCode: null, body: output ?? "" };
  return { exitCode: Number(match[1]), body: output.slice(match[0].length) };
}

/** `45s`, `4m 12s`, `1h 3m`: precise enough for a sandbox run. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The last `keep` lines, and how many came before them. */
export function tailLines(body: string, keep: number): { hidden: number; text: string } {
  const lines = body.split("\n");
  const hidden = Math.max(0, lines.length - keep);
  return { hidden, text: lines.slice(hidden).join("\n") };
}
