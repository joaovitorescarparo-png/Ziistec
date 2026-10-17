export const MOBILE_EDGE_SWIPE_PX = 28;
export const MOBILE_SWIPE_DISTANCE_PX = 52;
export const MOBILE_SWIPE_AXIS_RATIO = 1.25;
export const MOBILE_KEYBOARD_MIN_DELTA_PX = 140;

export function beginEdgeSwipe({ x, y, viewportWidth, edgePx = MOBILE_EDGE_SWIPE_PX }) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(viewportWidth)) return null;
  if (viewportWidth <= 0 || x < 0 || x > Math.min(edgePx, viewportWidth * 0.12)) return null;
  return { x, y };
}

export function classifyHorizontalSwipe(start, end, direction, {
  distancePx = MOBILE_SWIPE_DISTANCE_PX,
  axisRatio = MOBILE_SWIPE_AXIS_RATIO,
} = {}) {
  if (!start || !end) return null;
  const dx = Number(end.x) - Number(start.x);
  const dy = Number(end.y) - Number(start.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const horizontal = Math.abs(dx) >= distancePx && Math.abs(dx) >= Math.abs(dy) * axisRatio;
  if (!horizontal) return null;
  if (direction === "open" && dx > 0) return "open";
  if (direction === "close" && dx < 0) return "close";
  return null;
}

export function isKeyboardViewportOpen({ layoutHeight, visualHeight, minDeltaPx = MOBILE_KEYBOARD_MIN_DELTA_PX }) {
  const layout = Number(layoutHeight);
  const visual = Number(visualHeight);
  if (!Number.isFinite(layout) || !Number.isFinite(visual) || layout <= 0 || visual <= 0) return false;
  const delta = layout - visual;
  return delta >= minDeltaPx && visual / layout <= 0.82;
}
