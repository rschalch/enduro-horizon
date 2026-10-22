// DOM overlay: day/time panel, cars-to-pass counter, odometer, speedometer and
// transient messages.

const ARC = 2 * Math.PI * 56 * 0.75;

export class HUD {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.root = this.$('hud');
    this.cache = {};
    this.toastTimer = 0;
    this.centerTimer = 0;
  }

  set(id, value) {
    if (this.cache[id] === value) return;
    this.cache[id] = value;
    this.$(id).textContent = value;
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  update(d) {
    this.set('day', String(d.day));
    this.set('todName', d.todName);
    this.set('todIcon', d.todIcon);
    this.$('dayFill').style.width = `${(d.dayT * 100).toFixed(1)}%`;
    const left = Math.max(0, d.target - d.passed);
    this.set('carsLeft', left ? String(left) : '✓');
    this.$('carsPanel').classList.toggle('done', left === 0);
    this.set('odo', (d.odo / 1000).toFixed(1).padStart(5, '0'));
    this.set('speed', String(Math.round(d.speed)));
    this.set('gear', d.gear);
    this.set('biomeName', d.biome);
    const frac = Math.min(1, d.speed / 240);
    this.$('speedArc').setAttribute('stroke-dasharray', `${(ARC * frac).toFixed(1)} 400`);
    this.$('hud').classList.toggle('night', d.night > 0.5);
  }

  toast(top, title, accent) {
    const el = this.$('toast');
    el.innerHTML = `<small>${top}</small><b>${title}</b>`;
    el.style.setProperty('--a1', accent[0]);
    el.style.setProperty('--a2', accent[1]);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  center(text, cls = '', ms = 1200) {
    const el = this.$('center');
    el.textContent = text;
    el.className = `show ${cls}`;
    clearTimeout(this.centerTimer);
    if (ms) this.centerTimer = setTimeout(() => (el.className = ''), ms);
  }
}
