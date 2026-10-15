import "server-only";

const MAX_VERSIONS = 40;
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
// npm package names: optional @scope/, then lowercase URL-safe characters.
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function isPackageName(value: string): boolean {
  return value.length <= 214 && PACKAGE_NAME.test(value);
}

function compareDesc(a: string, b: string): number {
  const x = a.match(STABLE)!.slice(1).map(Number);
  const y = b.match(STABLE)!.slice(1).map(Number);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

/** Stable releases of a package, newest first, or null when npm does not know it. */
export async function getVersions(name: string): Promise<{ latest: string | null; versions: string[] } | null> {
  const encoded = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const response = await fetch(`https://registry.npmjs.org/${encoded}`, {
    // The abbreviated document carries versions and dist-tags without the full metadata.
    headers: { Accept: "application/vnd.npm.install-v1+json" },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry answered ${response.status} for ${name}`);

  const body = (await response.json()) as { "dist-tags"?: { latest?: string }; versions?: Record<string, unknown> };
  const versions = Object.keys(body.versions ?? {})
    .filter((version) => STABLE.test(version))
    .sort(compareDesc)
    .slice(0, MAX_VERSIONS);
  return { latest: body["dist-tags"]?.latest ?? null, versions };
}
