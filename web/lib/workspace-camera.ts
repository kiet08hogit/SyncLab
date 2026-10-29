/** User-supplied footage: 0:02 through 0:06, then a held monitor frame and a new gleam. */
export const WORKSPACE_FPS = 24;
export const WORKSPACE_FRAMES = 144;
export const WORKSPACE_WIDTH = 1280;
export const WORKSPACE_HEIGHT = 720;
export const SOURCE_START_FRAME = 2 * WORKSPACE_FPS;
export const SOURCE_TRAVEL_FRAMES = 4 * WORKSPACE_FPS;

const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function heroCopyHidden(motion: boolean, copy: number, top: number, bottom: number, viewportHeight: number) {
  return motion && copy < 0.02 && bottom > 0 && top < viewportHeight;
}

export function workspaceCamera(progress: number) {
  const hold = SOURCE_TRAVEL_FRAMES / (WORKSPACE_FRAMES - 1);
  const gleam = smooth((progress - hold) / (1 - hold));
  return {
    gleam,
    screen: smooth(gleam / .38),
    bloom: smooth((gleam - .22) / .78),
    paper: smooth((gleam - .70) / .30),
    copy: 1 - smooth((progress - .06) / .25),
    handoff: smooth((gleam - .70) / .30),
  };
}
