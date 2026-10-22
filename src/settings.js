// Sound settings panel: volume sliders, mute, music toggle and song skip.
// Opens with the speaker button or the O key; N skips to the next song.

const SLIDERS = [
  ['master', 'Master'],
  ['music', 'Music'],
  ['sfx', 'Effects'],
  ['engine', 'Engine'],
];

export function initSettings(audio) {
  const btn = document.getElementById('soundBtn');
  const panel = document.getElementById('soundPanel');
  const list = document.getElementById('soundSliders');
  const muteBtn = document.getElementById('muteBtn');
  const musicBtn = document.getElementById('musicBtn');
  const nextBtn = document.getElementById('nextSongBtn');
  const songEl = document.getElementById('songName');
  if (!btn || !panel) return;

  const stop = (e) => e.stopPropagation();
  for (const el of [btn, panel]) {
    el.addEventListener('pointerdown', stop);
    el.addEventListener('click', stop);
    el.addEventListener('keydown', (e) => {
      // Keep arrows/Enter from driving the game while a control has focus.
      if (e.code !== 'KeyO' && e.code !== 'Escape') e.stopPropagation();
    });
  }

  const inputs = {};
  for (const [key, label] of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'srow';
    row.innerHTML = `<span>${label}</span><input type="range" min="0" max="100" step="1"><b></b>`;
    const input = row.querySelector('input');
    const val = row.querySelector('b');
    input.value = Math.round(audio.settings[key] * 100);
    val.textContent = input.value;
    input.addEventListener('input', () => {
      audio.init();
      audio.setVolume(key, input.value / 100);
      val.textContent = input.value;
      if (key !== 'master' || !audio.settings.muted) refresh();
    });
    input.addEventListener('change', () => input.blur());
    inputs[key] = { input, val };
    list.appendChild(row);
  }

  function refresh() {
    const s = audio.settings;
    btn.textContent = s.muted || s.master === 0 ? '🔇' : '🔊';
    btn.classList.toggle('muted', s.muted);
    muteBtn.textContent = s.muted ? 'Unmute' : 'Mute all';
    muteBtn.classList.toggle('on', s.muted);
    musicBtn.textContent = s.musicOn ? 'Music: on' : 'Music: off';
    musicBtn.classList.toggle('on', !s.musicOn);
    for (const [key] of SLIDERS) {
      const { input, val } = inputs[key];
      input.value = Math.round(s[key] * 100);
      val.textContent = input.value;
    }
    if (audio.songTitle) songEl.textContent = `♪ ${audio.songTitle}`;
  }

  const toggle = (open = panel.classList.contains('hidden')) => {
    panel.classList.toggle('hidden', !open);
    btn.classList.toggle('active', open);
    if (open) refresh();
  };

  btn.addEventListener('click', () => {
    audio.init();
    toggle();
    btn.blur();
  });
  muteBtn.addEventListener('click', () => {
    audio.init();
    audio.toggleMute();
    refresh();
    muteBtn.blur();
  });
  musicBtn.addEventListener('click', () => {
    audio.init();
    audio.toggleMusic();
    refresh();
    musicBtn.blur();
  });
  nextBtn.addEventListener('click', () => {
    audio.init();
    audio.nextSong();
    nextBtn.blur();
  });
  document.getElementById('soundClose')?.addEventListener('click', () => toggle(false));

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyO') toggle();
    else if (e.code === 'KeyN') {
      audio.init();
      audio.nextSong();
    } else if (e.code === 'KeyM') setTimeout(refresh, 0);
    else if (e.code === 'Escape' && !panel.classList.contains('hidden')) toggle(false);
  });

  // Keep the song name current; chain any handler main.js sets later.
  const prevSong = audio.onSongChange;
  Object.defineProperty(audio, 'onSongChange', {
    configurable: true,
    get() {
      return this._songCb;
    },
    set(fn) {
      this._songCb = (title, artist) => {
        songEl.textContent = `♪ ${title}`;
        if (fn) fn(title, artist);
      };
    },
  });
  audio.onSongChange = prevSong;
  refresh();
  return { toggle, refresh };
}
