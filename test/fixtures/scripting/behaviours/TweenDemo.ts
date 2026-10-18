// Moves, recolours and scales its object with tweens in a coroutine, then writes into a Text and fires an event.
import { Behaviour, prop, wait, sequence, Vector2, type PropsOf } from '../gpsb/engine.js';
import { label } from '../extensions/lib/format.ts';

enum Phase { Idle, Moving, Done }

class TweenDemo extends Behaviour {
  static props = {
    target: prop.node({ component: 'Text' }),
    distance: prop.number(200),
    tint: prop.color('#ff3366'),
    onDone: prop.event(),
  };
  phase = Phase.Idle;

  start() { this.startCoroutine(this.run); }

  *run(this: TweenDemo) {
    this.phase = Phase.Moving;
    yield this.webObject.moveBy(new Vector2(this.distance, 0), 0.3).ease('outCubic');
    yield wait(0.05);
    yield sequence().append(this.webObject.colorTo(this.tint, 0.2)).join(this.webObject.scaleTo(1.5, 0.2));
    this.phase = Phase.Done;
    if (this.target) this.target.text = label('done', this.phase);
    this.onDone.invoke('ok');
  }
}
interface TweenDemo extends PropsOf<typeof TweenDemo.props> {} // typed fields for the props
export default TweenDemo;
