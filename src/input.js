// Keyboard, touch and gamepad merged into three analog controls.

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.pad = { steer: 0, gas: 0, brake: 0, start: false };
    this.padStartPrev = false;
    this.onStart = null;

    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    for (const [id, key] of [['tLeft', 'left'], ['tRight', 'right'], ['tGas', 'gas'], ['tBrake', 'brake']]) {
      const el = document.getElementById(id);
      if (!el) continue;
      const on = (e) => {
        e.preventDefault();
        this.touch[key] = true;
        el.classList.add('down');
      };
      const off = (e) => {
        e.preventDefault();
        this.touch[key] = false;
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    }
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p);
    if (gp) {
      const ax = gp.axes[0] || 0;
      this.pad.steer = Math.abs(ax) > 0.15 ? ax : (gp.buttons[15]?.pressed ? 1 : 0) - (gp.buttons[14]?.pressed ? 1 : 0);
      this.pad.gas = Math.max(gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0);
      this.pad.brake = Math.max(gp.buttons[6]?.value || 0, gp.buttons[1]?.pressed ? 1 : 0);
      const start = !!gp.buttons[9]?.pressed;
      if (start && !this.padStartPrev && this.onStart) this.onStart();
      this.padStartPrev = start;
    } else {
      this.pad.steer = this.pad.gas = this.pad.brake = 0;
    }
  }

  get steer() {
    const k = this.keys;
    const kb = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const t = (this.touch.right ? 1 : 0) - (this.touch.left ? 1 : 0);
    return Math.max(-1, Math.min(1, kb + t + this.pad.steer));
  }

  get throttle() {
    const k = this.keys;
    return Math.min(1, (k.has('ArrowUp') || k.has('KeyW') || k.has('Space') || this.touch.gas ? 1 : 0) + this.pad.gas);
  }

  get brake() {
    const k = this.keys;
    return Math.min(1, (k.has('ArrowDown') || k.has('KeyS') || this.touch.brake ? 1 : 0) + this.pad.brake);
  }
}
