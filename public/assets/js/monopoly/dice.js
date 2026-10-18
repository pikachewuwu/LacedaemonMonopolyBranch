// zwei echte 3d-würfel aus css

import { h, wait } from './dom.js';

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// welche drehung zeigt welche zahl vorne
const FACE_ROTATION = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
const FACE_PLACE = { 1: 'front', 2: 'right', 3: 'top', 4: 'bottom', 5: 'left', 6: 'back' };

function cube() {
  const faces = Object.entries(FACE_PLACE).map(([n, place]) =>
    h(`span.die-face.face-${place}`, ...Array.from({ length: 9 }, (_, k) => h(PIPS[n].includes(k) ? 'i.pip' : 'i'))));
  const body = h('span.die-cube', ...faces);
  return { el: h('span.die', body), body, x: 0, y: 0 };
}

export class Dice {
  constructor() {
    this.cubes = [cube(), cube()];
    this.el = h('div.dice', this.cubes.map(c => c.el));
    this.values = null;
    this.show([5, 2], true);
  }

  show(values, instant = false) {
    if (!values) return;
    this.values = values;
    this.cubes.forEach((c, i) => {
      const [x, y] = FACE_ROTATION[values[i]];
      c.x = x;
      c.y = y;
      c.body.style.transition = instant ? 'none' : '';
      c.body.style.transform = `rotateX(${x}deg) rotateY(${y}deg)`;
    });
  }

  async roll(values, fast = false) {
    this.values = values;
    if (fast) return this.show(values, true);
    this.el.classList.add('is-rolling');
    this.cubes.forEach((c, i) => {
      const [x, y] = FACE_ROTATION[values[i]];
      // ganze umdrehungen dazu, damit es nach würfeln aussieht
      const spinX = 360 * (2 + Math.floor(Math.random() * 2)) * (i ? -1 : 1);
      const spinY = 360 * (2 + Math.floor(Math.random() * 2));
      c.x = x + spinX + Math.round(c.x / 360) * 360;
      c.y = y + spinY + Math.round(c.y / 360) * 360;
      c.body.style.transition = '';
      c.body.style.transform = `rotateX(${c.x}deg) rotateY(${c.y}deg)`;
    });
    await wait(850);
    this.el.classList.remove('is-rolling');
    this.el.classList.toggle('is-double', values[0] === values[1]);
  }
}
