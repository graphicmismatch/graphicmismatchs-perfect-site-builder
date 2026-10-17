// Rotates the node continuously (rect.rotation), like a Unity Update() spinner.
export const props = {
  speed: { type: 'number', default: 90, help: 'degrees per second' },
};

export default class Spin {
  update(dt) {
    this.node.rect.rotation = (this.node.rect.rotation + this.props.speed * dt) % 360;
    this.apply();
  }
  // public: callable from a Button's onClick as behaviour:Spin.spinFaster
  spinFaster() {
    this.props.speed *= 2;
    if (Math.abs(this.props.speed) > 1500) this.props.speed = Math.sign(this.props.speed) * 45;
  }
  reverse() { this.props.speed = -this.props.speed; }
}
