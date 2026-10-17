// Offsets rect.pos toward the mouse (smoothed). Put it on a few layers with different strengths for depth.
export const props = {
  strength: { type: 'number', default: 24, help: 'max offset in px (negative = opposite direction)' },
  smoothing: { type: 'number', default: 6, min: 1, max: 20, help: 'higher = snappier' },
};

export default class MouseParallax {
  start() {
    this.base = [...this.node.rect.pos];
    this.goal = [0, 0];
    this.cur = [0, 0];
    this.enabled = true;
    addEventListener('pointermove', e => {
      this.goal = [e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5].map(v => v * 2 * this.props.strength);
    });
  }
  update(dt) {
    const goal = this.enabled ? this.goal : [0, 0], k = 1 - Math.exp(-this.props.smoothing * dt);
    const d = goal.map((g, i) => g - this.cur[i]);
    if (Math.abs(d[0]) + Math.abs(d[1]) < 0.05) return;
    this.cur = this.cur.map((c, i) => c + d[i] * k);
    this.node.rect.pos = this.base.map((b, i) => b + this.cur[i]);
    this.apply();
  }
  // public: turn the effect on/off ('true' | 'false' | anything else toggles)
  toggle(arg) { this.enabled = arg === 'true' ? true : arg === 'false' ? false : !this.enabled; }
}
