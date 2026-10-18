// Types for gpsb/frame.js (the shared frame clock). Copied into projects by `gpsb types`.

export interface TimeState {
  /** Seconds since the last frame, scaled by timeScale (at most maximumDeltaTime). */
  deltaTime: number;
  /** Real seconds since the last frame (at most maximumDeltaTime). */
  unscaledDeltaTime: number;
  /** Scaled seconds since the page started running scripts. */
  time: number;
  unscaledTime: number;
  frameCount: number;
  /** 1 = normal speed, 0 = paused, 0.5 = slow motion. Affects behaviours, coroutines and tweens (not Animators). */
  timeScale: number;
  maximumDeltaTime: number;
}
export const Time: TimeState;

/** Call fn every frame (order: update 0, coroutines 10, tweens 20, lateUpdate 30). Returns a function that stops it. */
export function onFrame(fn: (deltaTime: number, unscaledDeltaTime: number) => void, order?: number): () => void;
/** Advance one frame by dt real seconds (tests, with manualFrames()). */
export function step(dt: number): void;
export function manualFrames(on?: boolean): void;
/** Re-apply a node at the end of the current task (once, however many times it's marked). */
export function markDirty(node: object, el?: Element | null): void;
export function flush(): void;
