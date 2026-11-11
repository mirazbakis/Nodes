// Small platform layer: tags <html> with "mac" or "win" for styling, and on Windows
// adapts Mac wording and shortcut symbols in everything the UI renders.
(function () {
  // Apply the saved appearance before first paint (the settings file loads later and confirms it).
  try {
    const t = localStorage.getItem('nodes.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {}
  const IS_WIN = /^Win/i.test(navigator.platform || '') || /Windows/i.test(navigator.userAgent);
  window.IS_WIN = IS_WIN;
  document.documentElement.classList.add(IS_WIN ? 'win' : 'mac');
  if (!IS_WIN) return;
  const swaps = [
    [/your Mac['’]s keychain/g, "Windows' secure storage"],
    [/your macOS keychain/g, "Windows' secure storage"],
    [/macOS keychain/g, 'Windows secure storage'],
    [/Show in Finder/g, 'Show in File Explorer'],
    [/\b(this|your|the) Mac\b/g, '$1 PC'],
    [/\bon your Mac\b/g, 'on your PC'],
    [/⌘\s?/g, 'Ctrl+'],
  ];
  const fix = (s) => {
    let out = s;
    for (const [re, to] of swaps) out = out.replace(re, to);
    return out;
  };
  const visit = (root) => {
    if (root.nodeType === 3) {
      const v = fix(root.nodeValue);
      if (v !== root.nodeValue) root.nodeValue = v;
      return;
    }
    if (root.nodeType !== 1) return;
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = root.getAttribute && root.getAttribute(a);
      if (v) {
        const f = fix(v);
        if (f !== v) root.setAttribute(a, f);
      }
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (w.nextNode()) {
      const n = w.currentNode;
      if (n.nodeType === 3) {
        if (n.parentElement && n.parentElement.closest('pre, code, textarea, .md')) continue;
        const v = fix(n.nodeValue);
        if (v !== n.nodeValue) n.nodeValue = v;
      } else {
        for (const a of ['title', 'placeholder', 'aria-label']) {
          const v = n.getAttribute(a);
          if (v) {
            const f = fix(v);
            if (f !== v) n.setAttribute(a, f);
          }
        }
      }
    }
  };
  const start = () => {
    visit(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') visit(m.target);
        else for (const n of m.addedNodes) if (!(n.parentElement && n.parentElement.closest('.md'))) visit(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
