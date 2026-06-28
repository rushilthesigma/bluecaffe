// "Contain" fit for a source of (srcW × srcH) inside a (projW × projH) frame.
// Returns half-extent factors in clip space, where the full frame spans 1 on
// each axis at scale 1. A source whose aspect matches the frame returns
// {ax:1, ay:1} (fills the frame, unchanged). A wider source keeps full width
// and shrinks its height; a taller/narrower one keeps full height and shrinks
// its width — so off-aspect media is letterboxed/pillarboxed, never stretched.
export function fitExtents(
  srcW: number | null | undefined,
  srcH: number | null | undefined,
  projW: number,
  projH: number,
): { ax: number; ay: number } {
  if (!srcW || !srcH || srcW <= 0 || srcH <= 0 || projW <= 0 || projH <= 0) {
    return { ax: 1, ay: 1 };
  }
  const srcAR = srcW / srcH;
  const projAR = projW / projH;
  if (srcAR > projAR) return { ax: 1, ay: projAR / srcAR };
  return { ax: srcAR / projAR, ay: 1 };
}
