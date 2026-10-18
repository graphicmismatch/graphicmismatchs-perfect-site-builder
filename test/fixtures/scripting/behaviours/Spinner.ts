// Rotates its object; reverse() is callable from events.
import { Behaviour, prop, Time } from '../gpsb/engine.js';

export default class Spinner extends Behaviour {
  static props = { speed: prop.number(90, { help: 'degrees per second' }) };
  declare speed: number;

  update() { this.rectTransform.rotation += this.speed * Time.deltaTime; }
  reverse() { this.speed = -this.speed; }
}
