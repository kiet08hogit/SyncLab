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
