// Types the text of a Text node (default: this node) one character at a time by editing node data + apply().
export const props = {
  target: { type: 'node', default: '', help: 'Text node to type into (empty = this node)' },
  speed: { type: 'number', default: 32, help: 'characters per second' },
  delay: { type: 'number', default: 0, help: 'seconds before typing starts' },
  autoplay: { type: 'bool', default: true, help: 'off = wait for play() (e.g. from an animation event)' },
  caret: { type: 'bool', default: true },
};

export default class Typewriter {
  start() {
    this.text = this.textComp()?.props.text ?? '';
    if (this.props.autoplay) this.play();
  }
  textNode() { return this.props.target ? this.PSB.node(this.props.target) : this.node; }
  textComp() { return this.textNode()?.components.find(c => c.type === 'Text'); }
  // public: restart typing (from an event: behaviour:Typewriter.play); optional arg replaces the text
  play(text) {
    if (!this.textComp()) return;
    if (text) this.text = text;
    this.t = -this.props.delay;
    this.typing = true;
    this.show(0);
  }
  update(dt) {
    if (!this.typing) return;
    this.t += dt;
    const n = Math.min(this.text.length, Math.floor(Math.max(0, this.t) * this.props.speed));
    this.show(n);
    if (n === this.text.length) this.typing = false;
  }
  show(n) {
    if (n === this.n) return;
    this.n = n;
    const caret = this.props.caret ? '<span class="caret">|</span>' : '';
    this.textComp().props.text = this.text.slice(0, n) + caret;
    this.PSB.applyNode(this.textNode());
  }
}
