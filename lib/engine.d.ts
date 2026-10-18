// Types for gpsb/engine.js, the Unity-style scripting API. `gpsb types` copies this into a project's .gpsb/types/gpsb/
// (tsconfig rootDirs makes `import … from '../gpsb/engine.js'` resolve to it) next to project.d.ts, which fills in
// ComponentTypes with the project's components. Docs: docs/engine-api.md (tweening included).

// ---------- time ----------
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
/** Re-apply a node at the end of the current task (once, however many times it's marked). */
export function markDirty(node: object, el?: Element | null): void;

// ---------- value types ----------
export type Vec2Like = Vector2 | readonly [number, number] | { x: number; y: number } | number;
export type Vec4Like = Vector4 | readonly [number, number, number, number] | { x: number; y: number; z: number; w: number } | number;
export type ColorLike = Color | string;

/** Immutable 2D vector. The y axis points down (as on the web): Vector2.up is (0, -1). */
export class Vector2 {
  constructor(x?: number, y?: number);
  readonly x: number;
  readonly y: number;
  static from(v: Vec2Like): Vector2;
  add(v: Vec2Like): Vector2;
  sub(v: Vec2Like): Vector2;
  /** Scalar or per-axis. */
  mul(k: Vec2Like): Vector2;
  div(k: Vec2Like): Vector2;
  neg(): Vector2;
  withX(x: number): Vector2;
  withY(y: number): Vector2;
  dot(v: Vec2Like): number;
  readonly magnitude: number;
  readonly sqrMagnitude: number;
  readonly normalized: Vector2;
  equals(v: Vec2Like, eps?: number): boolean;
  toArray(): [number, number];
  toJSON(): [number, number];
  static distance(a: Vec2Like, b: Vec2Like): number;
  static lerp(a: Vec2Like, b: Vec2Like, t: number): Vector2;
  static lerpUnclamped(a: Vec2Like, b: Vec2Like, t: number): Vector2;
  static moveTowards(a: Vec2Like, b: Vec2Like, maxDelta: number): Vector2;
  /** Degrees between two directions. */
  static angle(a: Vec2Like, b: Vec2Like): number;
  static readonly zero: Vector2;
  static readonly one: Vector2;
  static readonly up: Vector2;
  static readonly down: Vector2;
  static readonly left: Vector2;
  static readonly right: Vector2;
}

export class Vector4 {
  constructor(x?: number, y?: number, z?: number, w?: number);
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  static from(v: Vec4Like): Vector4;
  add(v: Vec4Like): Vector4;
  sub(v: Vec4Like): Vector4;
  mul(k: Vec4Like): Vector4;
  equals(v: Vec4Like, eps?: number): boolean;
  toArray(): [number, number, number, number];
  toJSON(): [number, number, number, number];
  static lerp(a: Vec4Like, b: Vec4Like, t: number): Vector4;
  static lerpUnclamped(a: Vec4Like, b: Vec4Like, t: number): Vector4;
  static readonly zero: Vector4;
  static readonly one: Vector4;
}

/** Immutable RGBA colour (channels 0..1). Converts to '#rrggbb(aa)' wherever a string is expected. */
export class Color {
  constructor(r?: number, g?: number, b?: number, a?: number);
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  /** The original value when it isn't a hex colour (a '$token', 'var(--…)'); its channels are NaN. */
  readonly css: string | null;
  readonly valid: boolean;
  /** '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', or any other CSS value (kept as-is). null for ''. */
  static parse(v: ColorLike | null | undefined): Color | null;
  static hex(s: string): Color;
  static rgba(r: number, g: number, b: number, a?: number): Color;
  static rgb255(r: number, g: number, b: number, a?: number): Color;
  /** A design token from project.json, e.g. Color.token('brand') -> '$brand'. */
  static token(name: string): Color;
  withAlpha(a: number): Color;
  toHex(): string;
  toJSON(): string;
  static lerp(a: ColorLike, b: ColorLike, t: number): Color;
  static lerpUnclamped(a: ColorLike, b: ColorLike, t: number): Color;
  static readonly white: Color;
  static readonly black: Color;
  static readonly clear: Color;
  static readonly red: Color;
  static readonly green: Color;
  static readonly blue: Color;
  static readonly yellow: Color;
  static readonly cyan: Color;
  static readonly magenta: Color;
  static readonly gray: Color;
}

export const Mathf: {
  readonly PI: number;
  readonly Deg2Rad: number;
  readonly Rad2Deg: number;
  readonly Epsilon: number;
  readonly Infinity: number;
  clamp(v: number, min: number, max: number): number;
  clamp01(v: number): number;
  lerp(a: number, b: number, t: number): number;
  lerpUnclamped(a: number, b: number, t: number): number;
  inverseLerp(a: number, b: number, v: number): number;
  repeat(t: number, length: number): number;
  pingPong(t: number, length: number): number;
  deltaAngle(a: number, b: number): number;
  lerpAngle(a: number, b: number, t: number): number;
  moveTowards(a: number, b: number, maxDelta: number): number;
  moveTowardsAngle(a: number, b: number, maxDelta: number): number;
  smoothStep(a: number, b: number, t: number): number;
  /** Critically damped spring towards target; keep `state` between calls. */
  smoothDamp(current: number, target: number, state: { velocity?: number }, smoothTime: number, maxSpeed?: number, deltaTime?: number): number;
  approximately(a: number, b: number): boolean;
};

export const Random: {
  /** 0 <= value < 1 */
  readonly value: number;
  range(min: number, max: number): number;
  /** Whole number, max exclusive. */
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  readonly insideUnitCircle: Vector2;
  readonly onUnitCircle: Vector2;
};

// ---------- props ----------
/** A props schema entry (see docs/prop-types.md). V is the type the script sees for it. */
export interface PropSchema<V = unknown> {
  type: string;
  default: unknown;
  help?: string;
  [option: string]: unknown;
  /** @internal type-only */
  readonly __value?: V;
}
interface Opts { help?: string; [option: string]: unknown }
export const prop: {
  number(dflt?: number, opts?: Opts & { min?: number; max?: number; step?: number }): PropSchema<number>;
  int(dflt?: number, opts?: Opts & { min?: number; max?: number; step?: number }): PropSchema<number>;
  string(dflt?: string, opts?: Opts): PropSchema<string>;
  text(dflt?: string, opts?: Opts & { rich?: boolean }): PropSchema<string>;
  code(dflt?: string, lang?: 'html' | 'css' | 'js', opts?: Opts): PropSchema<string>;
  bool(dflt?: boolean, opts?: Opts): PropSchema<boolean>;
  href(dflt?: string, opts?: Opts): PropSchema<string>;
  color(dflt?: ColorLike, opts?: Opts): PropSchema<Color>;
  vec2(dflt?: Vec2Like, opts?: Opts & { labels?: [string, string] }): PropSchema<Vector2>;
  vec4(dflt?: Vec4Like, opts?: Opts & { labels?: [string, string, string, string] }): PropSchema<Vector4>;
  enum<const O extends readonly string[]>(options: O, dflt?: O[number], opts?: Opts): PropSchema<O[number]>;
  /** Asset path inside assets/ (anim: a clip name). Turn it into a URL with Assets.url / GPSB.assets.url. */
  asset(kind?: 'image' | 'video' | 'audio' | 'json' | 'font' | 'text' | 'anim' | 'any', dflt?: string, opts?: Opts): PropSchema<string>;
  /** An object picked in the Inspector; with { component: 'Text' } the field holds that component. */
  node<K extends keyof ComponentTypes>(opts: Opts & { component: K }): PropSchema<ComponentRef<K> | null>;
  node(opts?: Opts): PropSchema<WebObject | null>;
  event(opts?: Opts & { on?: string }): PropSchema<WebEvent>;
  list<T = string>(of?: string, dflt?: T[], opts?: Opts): PropSchema<T[]>;
};
/** The field types of a props schema: `interface Spin extends PropsOf<typeof Spin.props> {}` next to `class Spin`. */
export type PropsOf<S> = { -readonly [K in keyof S]: S[K] extends PropSchema<infer V> ? V : unknown };

// ---------- page data ----------
export interface RectData {
  anchorMin: [number, number];
  anchorMax: [number, number];
  pivot: [number, number];
  pos: [number, number];
  size: [number, number];
  rotation: number;
  scale: [number, number];
  zIndex?: number;
}
export interface ComponentData { type: string; props?: Record<string, any> }
export interface NodeData {
  id: string;
  name: string;
  active?: boolean;
  rect: RectData;
  components: ComponentData[];
  children: NodeData[];
  overrides?: Record<string, Record<string, unknown>>;
}
export interface RenderCtx {
  /** Published URL of an asset path. */
  asset(path: string): string;
  font(path: string): string;
  /** URL for a page name, link or #anchor. */
  href(link: string): string;
  editor?: boolean;
  [key: string]: any;
}
export interface AnimatorController {
  play(clip?: string): void;
  stop(): void;
  pause(): void;
  resume(): void;
  seek(t: number): void;
  readonly playing: boolean;
  readonly time: number;
  readonly clip: string;
  speed: number;
}
/** window.GPSB, the page runtime (docs/runtime-api.md). */
export interface Gpsb {
  data: { tree: NodeData; [key: string]: any };
  ctx: RenderCtx;
  editor: boolean;
  scale: number;
  canvas: HTMLElement;
  node(id: string): NodeData | undefined;
  parent(id: string): NodeData | undefined;
  find(path: string, from?: NodeData): NodeData | null;
  el(id: string): HTMLElement | null;
  els(id: string): HTMLElement[];
  nodeFor(el: Element): NodeData;
  preload(url: string): HTMLImageElement;
  breakpoints(): string[];
  effective(node: NodeData): NodeData;
  applyNode(node: NodeData, parent?: NodeData, els?: Element | Element[]): void;
  setActive(id: string, on: boolean | 'toggle'): void;
  invoke(target: string, call: string, arg?: string, sourceId?: string): unknown;
  behaviour<T = any>(id: string, name: string): T | null;
  animator(id: string, el?: Element): AnimatorController | null;
  assets: { url(path: string): string; json(path: string): Promise<any>; text(path: string): Promise<string> };
}
declare global { interface Window { GPSB: Gpsb } }

// ---------- objects ----------
/** One prop per field, filled in by project.d.ts (`gpsb types`) for built-ins, extensions and custom components. */
export interface ComponentTypes {}

export interface ComponentRefBase<K extends string = string> {
  readonly webObject: WebObject;
  readonly type: K;
  readonly data: ComponentData;
  /** The raw stored values. */
  readonly props: Record<string, any>;
  /** Tween one of this component's props: text.tween('color', Color.red, 0.3). */
  tween(prop: string, to: unknown, duration: number): Tween;
}
/** A component of an object with its props as typed fields; setting one re-applies the object at the end of the frame. */
export type ComponentRef<K extends keyof ComponentTypes = never> = [K] extends [never]
  ? ComponentRefBase & Record<string, any>
  : ComponentRefBase<K & string> & ComponentTypes[K];

/** An event list (an `event` prop). */
export class WebEvent {
  readonly entries: Array<{ target: string; call: string; arg: string }>;
  addListener(fn: (arg: unknown) => void): this;
  removeListener(fn: (arg: unknown) => void): this;
  /** Run every entry (an entry with an empty argument receives `arg`) and every listener. */
  invoke(arg?: unknown): void;
}

type GetComponent = {
  <K extends keyof ComponentTypes>(type: K, index?: number): ComponentRef<K> | null;
  <T>(type: abstract new (...a: any[]) => T): T | null;
  (type: string, index?: number): (ComponentRefBase & Record<string, any>) | Behaviour | null;
};

/** A node on the page (Unity's GameObject). Pinned to one element inside a Repeat copy, else all of the node's. */
export class WebObject {
  readonly node: NodeData;
  readonly el: HTMLElement | null;
  /** Node data, id or path. nearEl: inside the same Repeat copy as that element. */
  static of(x: NodeData | WebObject | string, nearEl?: Element | null): WebObject | null;
  /** By path from the page root ('Header/Logo') or a unique name. */
  static find(path: string): WebObject | null;
  readonly id: string;
  name: string;
  active: boolean;
  setActive(on: boolean | 'toggle'): void;
  readonly elements: HTMLElement[];
  readonly element: HTMLElement | null;
  readonly parent: WebObject | null;
  readonly children: WebObject[];
  /** A descendant by path of names ('Panel/Icon'). */
  find(path: string): WebObject | null;
  readonly rectTransform: RectTransform;
  getComponent: GetComponent;
  getComponents<K extends keyof ComponentTypes>(type: K): Array<ComponentRef<K>>;
  getComponents(type: string): Array<ComponentRefBase & Record<string, any>>;
  /** Add a built-in or extension component with its defaults. */
  addComponent<K extends keyof ComponentTypes>(type: K, props?: Partial<Record<string, unknown>>): ComponentRef<K>;
  addComponent(type: string, props?: Record<string, unknown>): ComponentRefBase & Record<string, any>;
  /** Re-apply now (API changes are applied at the end of the frame anyway). */
  apply(): void;
  /** Mark for re-apply at the end of the frame (after changing node data yourself). */
  changed(): void;
  // tween shortcuts
  tween(path: string, to: unknown, duration: number): Tween;
  moveTo(pos: Vec2Like, duration: number): Tween;
  moveBy(offset: Vec2Like, duration: number): Tween;
  rotateTo(degrees: number, duration: number): Tween;
  scaleTo(scale: Vec2Like, duration: number): Tween;
  sizeTo(size: Vec2Like, duration: number): Tween;
  /** Opacity through a CanvasGroup (added if missing). */
  fadeTo(alpha: number, duration: number): Tween;
  /** Image colour, else Text colour. */
  colorTo(color: ColorLike, duration: number): Tween;
  shake(strength?: Vec2Like, duration?: number, vibrato?: number): Tween;
  punchScale(amount?: Vec2Like, duration?: number, vibrato?: number): Tween;
  killTweens(complete?: boolean): void;
}

/** Unity's RectTransform over node.rect. Vectors are immutable: assign a new one. */
export class RectTransform {
  readonly webObject: WebObject;
  anchoredPosition: Vector2;
  sizeDelta: Vector2;
  anchorMin: Vector2;
  anchorMax: Vector2;
  pivot: Vector2;
  localScale: Vector2;
  /** Degrees, clockwise. */
  rotation: number;
  zIndex: number;
  getBoundingClientRect(): DOMRect | null;
}

// ---------- tweening ----------
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

// ---------- coroutines ----------
export type Yieldable = null | undefined | { seconds: number; unscaled?: boolean } | { until(): boolean } | PromiseLike<unknown> | Iterator<Yieldable>;
export function wait(seconds: number): { seconds: number };
/** Ignores Time.timeScale. */
export function waitRealtime(seconds: number): { seconds: number; unscaled: true };
export function waitUntil(fn: () => boolean): { until(): boolean };
export function waitWhile(fn: () => boolean): { until(): boolean };
export const nextFrame: null;
export class Coroutine implements PromiseLike<boolean> {
  readonly done: boolean;
  stop(): void;
  /** Resolves true when the generator finishes, false when stopped. */
  then<A = boolean, B = never>(ok?: ((finished: boolean) => A | PromiseLike<A>) | null, err?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B>;
}

// ---------- behaviours ----------
/**
 * Base class for behaviours (Unity's MonoBehaviour). `static props` become Inspector fields and typed fields on the
 * instance: declare them (`declare speed: number`) or merge `interface X extends PropsOf<typeof X.props> {}`.
 */
export class Behaviour {
  static props?: Record<string, PropSchema<any>>;
  /** The element this instance runs on. */
  readonly el: HTMLElement;
  /** This object's node data (a per-copy clone inside a Repeat). */
  readonly node: NodeData;
  /** Raw prop values (shared with the Animator). */
  props: Record<string, any>;
  readonly GPSB: Gpsb;
  /** The Animator controller on this object or a parent. */
  readonly animator: AnimatorController | null;
  /** Node data of a descendant ('Label', 'Panel/Icon') or a name. */
  find(path: string): NodeData | null;
  /** Re-apply this object now. */
  apply(): void;
  setActive(on: boolean): void;

  readonly webObject: WebObject;
  readonly rectTransform: RectTransform;
  readonly name: string;
  getComponent: GetComponent;
  getComponents<K extends keyof ComponentTypes>(type: K): Array<ComponentRef<K>>;
  /** A descendant by path, else any object by path or unique name. */
  findObject(path: string): WebObject | null;
  tween(path: string, to: unknown, duration: number): Tween;
  /** A generator (or generator function, called with this). */
  startCoroutine<A extends any[]>(gen: Iterator<Yieldable> | ((this: any, ...args: A) => Iterator<Yieldable>), ...args: A): Coroutine;
  stopCoroutine(c: Coroutine | null | undefined): void;
  stopAllCoroutines(): void;

  start?(): void | Promise<void>;
  /** Every frame; deltaTime = Time.deltaTime. */
  update?(deltaTime: number): void;
  /** Every frame, after update, coroutines and tweens. */
  lateUpdate?(deltaTime: number): void;
  onClick?(e: MouseEvent): void;
}

// ---------- extensions ----------
export class SafeHtml { toString(): string }
/** HTML with every ${value} escaped; raw() and nested html`` pass through, arrays are joined. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml;
export function raw(s: unknown): SafeHtml;

export type CssDeclarations = Record<string, string | number | Color | null | undefined>;
export interface ExtensionState { prop?: string; events?: string[]; read(el: HTMLElement, GPSB: Gpsb): unknown; changed?(el: HTMLElement, GPSB: Gpsb): void }
/**
 * Base class for class-form extension components; export default defineExtension(MyExtension). Props are fields on
 * `this` in every hook. Build-time hooks (tag, style, attrs, inner, rules, childStyle, head) run in Node: no DOM there.
 */
export class Extension {
  static props?: Record<string, PropSchema<any>>;
  /** Add Component group (default 'Extensions'). */
  static category?: string;
  static state?: ExtensionState;
  static last?: boolean;
  /** Set in patch and init. */
  readonly el: HTMLElement;
  /** Set in style, rules and init. */
  readonly node: NodeData;
  readonly ctx: RenderCtx;
  /** init only: the component's index on the node, and the runtime. */
  readonly ci: number;
  readonly GPSB: Gpsb;
  /** init only. */
  readonly webObject: WebObject | null;
  apply(): void;

  tag?(): string | undefined;
  style?(ctx: RenderCtx, node: NodeData): CssDeclarations;
  attrs?(ctx: RenderCtx): Record<string, string | number | boolean | null | undefined>;
  inner?(ctx: RenderCtx): string | SafeHtml;
  rules?(selector: string, ctx: RenderCtx, node: NodeData): string | SafeHtml;
  childStyle?(child: NodeData): CssDeclarations;
  head?(ctx: RenderCtx): string | SafeHtml | Array<string | SafeHtml>;
  patch?(el: HTMLElement, ctx: RenderCtx): void;
  init?(el: HTMLElement): void;
}
export interface ExtensionDefinition { category: string; props: Record<string, PropSchema<any>>; [hook: string]: unknown }
export function defineExtension(cls: abstract new () => object): ExtensionDefinition;

/** Project assets (paths inside assets/), as on GPSB.assets. */
export const Assets: {
  /** The published URL (with its version), e.g. for an asset prop. */
  url(path: string): string;
  json<T = any>(path: string): Promise<T>;
  text(path: string): Promise<string>;
};
