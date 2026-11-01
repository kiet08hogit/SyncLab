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

  // Heading levels are joined with " / ". The release is the first x.y.z in a heading.
  const version = change.section
    .split(' / ')
    .map((heading) => /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(heading)?.[1])
    .find((candidate) => candidate !== undefined);
  return version ? { name, version } : undefined;
}
