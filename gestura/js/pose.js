// Pure landmark geometry. No MediaPipe import, so every pose rule here is
// testable in Node without a browser or a model file.

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

export const FINGER_TIPS = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
export const FINGER_PIPS = [LM.THUMB_IP, LM.INDEX_PIP, LM.MIDDLE_PIP, LM.RING_PIP, LM.PINKY_PIP];

// Four fingers, each as [mcp, pip, dip, tip]. The thumb is handled separately
// because its joint chain folds sideways.
const DIGITS = [
  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
];

export const SKELETON = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * How open the hand is, 0 (fist) .. 1 (fingers spread).
 * Mean tip-to-wrist distance normalised by the fingers' own PIP distance, so
 * it is invariant to how far the hand is from the camera.
 */
export function openness(lm) {
  if (!lm || lm.length < 21) return 0;
  const wrist = lm[LM.WRIST];
  let tip = 0;
  let pip = 0;
  for (let i = 0; i < FINGER_TIPS.length; i++) {
    tip += dist(lm[FINGER_TIPS[i]], wrist);
    pip += dist(lm[FINGER_PIPS[i]], wrist);
  }
  const ratio = tip / Math.max(pip, 1e-3); // ~1.0 curled, ~1.9 spread
  return Math.max(0, Math.min(1, (ratio - 1.0) / 0.85));
}

/**
 * Whether each of the four fingers is curled, judged by whether the tip sits
 * closer to the wrist than that finger's own PIP joint does.
 */
export function curledFingers(lm) {
  if (!usableHand(lm)) return [false, false, false, false];
  const wrist = lm[LM.WRIST];
  return DIGITS.map(([, pip, , tip]) => dist(lm[tip], wrist) < dist(lm[pip], wrist) * 1.18);
}

/**
 * The pointing pose: four fingers curled, thumb extended.
 *
 * The thumb is judged against the pinky MCP rather than by its own PIP, because
 * a pointing thumb swings sideways — its tip-to-wrist distance barely changes
 * even when fully extended, so the wrist ratio would read it as curled.
 */
export function isPointing(lm) {
  if (!lm || lm.length < 21) return false;
  if (!curledFingers(lm).every(Boolean)) return false;
  return dist(lm[LM.THUMB_TIP], lm[LM.PINKY_MCP]) > dist(lm[LM.THUMB_IP], lm[LM.PINKY_MCP]) * 1.25;
}

/** Mean of the wrist and the four MCPs — stable under finger motion. */
export function palmCenter(lm) {
  // Tolerate a short landmark array: this runs on every detected hand every
  // frame, and a single malformed frame must not throw out of the frame loop.
  if (!lm || lm.length < 5) return null;
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

/** True when the landmark array is complete enough to reason about. */
export function usableHand(lm) {
  return !!lm && lm.length >= 21;
}

/**
 * Index finger extension as a ratio: tip-to-wrist over PIP-to-wrist.
 * ~1.0 folded, ~1.9 straight. Scale invariant.
 *
 * This, not overall hand spread, is the pen-down signal. Openness conflates
 * "is the index finger out" with "are the other fingers out", which made the
 * most natural writing gesture — one finger extended, the rest curled —
 * register as a lifted pen.
 */
export function indexExtension(lm) {
  if (!usableHand(lm)) return 0;
  const wrist = lm[LM.WRIST];
  const d = (i, j) => Math.hypot(lm[i].x - wrist.x, lm[i].y - wrist.y);
  const pip = d(LM.INDEX_PIP, LM.WRIST);
  if (pip < 1e-6) return 0;
  return d(LM.INDEX_TIP, LM.WRIST) / pip;
}

// Pen-down thresholds, with a gap between them. A single threshold makes the
// pen chatter when the finger hovers at the boundary, which shows up as a row of
// stray dots along the stroke.
export const DOWN_RATIO = 1.18;
export const UP_RATIO = 1.10;

/** Pen down when the index is out; hysteresis keeps it from chattering. */
export function isWriting(lm, wasDown = false) {
  const r = indexExtension(lm);
  return wasDown ? r > UP_RATIO : r > DOWN_RATIO;
}