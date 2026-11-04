interface ReleaseVersion {
  core: [number, number, number];
  pre: string[];
}

const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseRelease(version: string): ReleaseVersion | undefined {
  const match = RELEASE.exec(version.trim());
  if (!match) return undefined;
  const pre = match[4] ? match[4].split('.') : [];
  if (pre.some((identifier) => identifier.length === 0)) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre,
  };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^[0-9]+$/.test(left);
  const rightNumeric = /^[0-9]+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
    return 0;
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Negative when `installed` is older than `required`. Undefined when either is not a release. */
function compareReleases(installed: string, required: string): number | undefined {
  const left = parseRelease(installed);
  const right = parseRelease(required);
  if (!left || !right) return undefined;

  for (let index = 0; index < left.core.length; index++) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] < right.core[index] ? -1 : 1;
    }
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;

  const shared = Math.min(left.pre.length, right.pre.length);
  for (let index = 0; index < shared; index++) {
    const order = compareIdentifier(left.pre[index], right.pre[index]);
    if (order !== 0) return order;
  }
  if (left.pre.length === right.pre.length) return 0;
  return left.pre.length < right.pre.length ? -1 : 1;
}

/** True when the installed release is the required release or a newer one. */
export function satisfiesMinimum(installed: string, required: string): boolean {
  const order = compareReleases(installed, required);
  return order !== undefined && order >= 0;
}
