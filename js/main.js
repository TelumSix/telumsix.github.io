'use strict';

function showFatal(err) {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent = 'Error: ' + (err && err.stack ? err.stack : String(err));
}

window.addEventListener('error', (e) => {
  showFatal(e.error || e.message || 'Unknown error');
});
window.addEventListener('unhandledrejection', (e) => {
  showFatal(e.reason || 'Unhandled rejection');
});

function readSave() {
  try {
    const raw = localStorage.getItem(CFG.SAVE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('gone');
  setTimeout(() => el.remove(), 700);
}

function boot() {
  let game;
  try {
    game = new Game(readSave());
    window.game = game;
  } catch (e) {
    hideLoading();
    showFatal(e);
    console.error(e);
    return;
  }

  game.init().then(() => {
    hideLoading();
    game.start();
  }).catch((e) => {
    console.error(e);
    hideLoading();
    showFatal(e);
    game.start();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 40));
} else {
  setTimeout(boot, 40);
}
