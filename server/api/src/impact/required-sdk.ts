/** Only a versioned SDK changelog establishes the package version a change needs. */
const SDK_PACKAGES: Record<string, string> = {
  anthropic: '@anthropic-ai/sdk',
  openai: 'openai',
};

export interface SdkChangeSource {
  provider: string;
  sourceKind: string;
  section: string | null;
}

export function requiredSdk(
  change: SdkChangeSource,
): { name: string; version: string } | undefined {
  if (change.sourceKind !== 'sdk_changelog') return undefined;
  const name = SDK_PACKAGES[change.provider];
  if (!name || !change.section) return undefined;

  // The notes parser joins heading levels with " / ". A release heading starts
  // with its version, optionally prefixed by v, and may include a date after it.
  const version = change.section
    .split(' / ')
    .map((heading) => /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(heading)?.[1])
    .find((candidate) => candidate !== undefined);
  return version ? { name, version } : undefined;
}
