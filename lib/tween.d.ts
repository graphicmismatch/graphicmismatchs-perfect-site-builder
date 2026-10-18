// Types for gpsb/tween.js. Copied into projects by `gpsb types`. Docs: docs/tweening.md.

type EaseCurve = 'Sine' | 'Quad' | 'Cubic' | 'Quart' | 'Quint' | 'Expo' | 'Circ' | 'Back' | 'Elastic' | 'Bounce';
export type EaseName = 'linear' | `in${EaseCurve}` | `out${EaseCurve}` | `inOut${EaseCurve}`
  | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';
/** A name, a CSS cubic-bezier [x1, y1, x2, y2], or a function from progress (0..1) to eased progress. */
export type EaseLike = EaseName | [number, number, number, number] | ((u: number) => number);
export type LoopType = 'restart' | 'yoyo' | 'incremental';

export const Ease: Record<Exclude<EaseName, 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step'>, (u: number) => number>;
export function easeFn(e?: EaseLike): (u: number) => number;

/** What a tween can animate: a node, a WebObject, a node id or path, or any object. */
export type TweenTarget = object | string;

declare abstract class Timeline<Self> implements PromiseLike<boolean> {
  /** Ease of the progress (default 'outQuad'; sequences: 'linear'). */
  ease(e: EaseLike): Self;
  delay(seconds: number): Self;
  /** Total number of plays (-1 = forever). yoyo plays back and forth; incremental keeps adding the change. */
  loops(count: number, type?: LoopType): Self;
  speed(multiplier: number): Self;
  /** Ignore Time.timeScale. */
  unscaled(on?: boolean): Self;
  onStart(fn: () => void): Self;
  onUpdate(fn: (t: Self) => void): Self;
  onStepComplete(fn: (loopIndex: number) => void): Self;
  onComplete(fn: () => void): Self;
  onKill(fn: () => void): Self;

  readonly duration: number;
  /** Delay + duration × loops (Infinity for endless loops). */
  readonly totalDuration: number;
  readonly elapsed: number;
  /** 0..1 over totalDuration. */
  readonly progress: number;
  readonly isPlaying: boolean;
  readonly isComplete: boolean;
  /** Not completed and not killed. */
  readonly isActive: boolean;

  play(): Self;
  pause(): Self;
  togglePause(): Self;
  /** Jump to a time in seconds (delay included). */
  goto(seconds: number, andPlay?: boolean): Self;
  restart(): Self;
  /** Jump to the end and fire onComplete. */
  complete(): Self;
  /** Stop for good (complete = jump to the end first). */
  kill(complete?: boolean): Self;
  /** await tween -> true when it completes, false when it's killed. */
  then<A = boolean, B = never>(ok?: ((completed: boolean) => A | PromiseLike<A>) | null, err?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B>;
}

export class Tween extends Timeline<Tween> {
  /** The node or object being animated. */
  readonly target: unknown;
  /** Start from this value (or { path: value } for several) instead of the current one; set as soon as it plays. */
  from(value: unknown): Tween;
  /** `to` is an offset from the start value. */
  relative(on?: boolean): Tween;

  /** tween(target, 'rect.rotation', 360, 1): a property path (node / WebObject) or a field path (object). */
  static to(target: TweenTarget, path: string, to: unknown, duration: number): Tween;
  /** tween(target, { 'rect.pos': [0, 40], 'CanvasGroup.alpha': 0 }, 0.5) */
  static to(target: TweenTarget, values: Record<string, unknown>, duration: number): Tween;
  /** Animate from -> to, calling setter every frame. */
  static value<T>(from: T, to: T, duration: number, setter: (value: T) => void): Tween;
  /** Call fn after `seconds`. */
  static delay(seconds: number, fn?: () => void): Tween;
  static sequence(): Sequence;
  static of(target: TweenTarget): Array<Tween | Sequence>;
  static killOf(target: TweenTarget, complete?: boolean): void;
  static killAll(complete?: boolean): void;
  static pauseAll(): void;
  static isTweening(target: TweenTarget): boolean;
  /** Number of tweens advancing right now. */
  static readonly playing: number;
}

export class Sequence extends Timeline<Sequence> {
  /** After everything so far. */
  append(t: Tween | Sequence): Sequence;
  /** Together with the last appended one. */
  join(t: Tween | Sequence): Sequence;
  /** At an absolute time (seconds from the sequence's start). */
  insert(at: number, t: Tween | Sequence): Sequence;
  appendInterval(seconds: number): Sequence;
  appendCallback(fn: () => void): Sequence;
  insertCallback(at: number, fn: () => void): Sequence;
}

export const tween: typeof Tween.to;
export const sequence: typeof Tween.sequence;
export const delayedCall: typeof Tween.delay;
