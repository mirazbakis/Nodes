// Screen control UI.
// - In screen.html: the always-on-top "is controlling your screen" bar with its Stop button.
// - In the main window: a short note when the user takes back control.
(function () {
  const api = window.nodes;
  if (!api) return;
  if (document.body.dataset.page === 'screen-bar') {
    const show = (st) => {
      if (!st) return;
      document.getElementById('who').textContent = st.node || 'A node';
      document.getElementById('key').textContent = st.shortcut ? `or ${st.shortcut}` : '';
    };
    api.onScreenState(show);
    api.screenState().then(show);
    const btn = document.getElementById('stop');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Stopping…';
      api.screenStop();
    });
    return;
  }
  api.onScreenStopped((was) => {
    const name = (was && was.node) || 'The node';
    if (typeof window.toast === 'function') window.toast(`You took back control. ${name} stopped using your screen.`);
  });
})();
