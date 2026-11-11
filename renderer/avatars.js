// Procedural node portraits: a little bot on a gradient tile, drawn from a small spec.
// Shared by the desktop app and the phone web app.
(function (global) {
  const INK = '#0b1020';
  const FACE = '#f4f7fc';
  let n = 0;

  function head(shape) {
    switch (shape) {
      case 'round': return { el: `<circle cx="32" cy="36" r="17"/>`, top: 19 };
      case 'hex': return { el: `<path d="M32 17.5 48 26.5v18L32 53.5l-16-9v-18Z" stroke-linejoin="round"/>`, top: 17.5 };
      case 'tv': return { el: `<rect x="12.5" y="22" width="39" height="28" rx="7"/>`, top: 22 };
      case 'dome': return { el: `<path d="M14 47V37a18 18 0 0 1 36 0v10a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4Z"/>`, top: 19 };
      case 'shield': return { el: `<path d="M32 16.5 48.5 22.5V34c0 10-7.4 16.3-16.5 19.5C22.9 50.3 15.5 44 15.5 34V22.5Z"/>`, top: 16.5 };
      default: return { el: `<rect x="14" y="20" width="36" height="31" rx="9"/>`, top: 20 };
    }
  }
  function eyes(kind, c1) {
    switch (kind) {
      case 'visor': return `<rect x="18.5" y="29" width="27" height="10" rx="5" fill="${INK}"/><rect x="22.5" y="32" width="6" height="4" rx="2" fill="${c1}"/><rect x="35.5" y="32" width="6" height="4" rx="2" fill="${c1}"/>`;
      case 'wide': return `<circle cx="25" cy="34" r="5" fill="${INK}"/><circle cx="39" cy="34" r="5" fill="${INK}"/><circle cx="26.6" cy="32.4" r="1.7" fill="#fff"/><circle cx="40.6" cy="32.4" r="1.7" fill="#fff"/>`;
      case 'glasses': return `<circle cx="25" cy="34" r="5.4" fill="none" stroke="${INK}" stroke-width="2.4"/><circle cx="39" cy="34" r="5.4" fill="none" stroke="${INK}" stroke-width="2.4"/><path d="M30.4 34h3.2" stroke="${INK}" stroke-width="2.4"/><circle cx="25" cy="34" r="2" fill="${INK}"/><circle cx="39" cy="34" r="2" fill="${INK}"/>`;
      case 'cyclops': return `<circle cx="32" cy="33.5" r="7" fill="${INK}"/><circle cx="32" cy="33.5" r="3.4" fill="${c1}"/><circle cx="33.4" cy="32.1" r="1.3" fill="#fff"/>`;
      case 'squint': return `<path d="M20.5 34.5q4.5-3.6 9 0M34.5 34.5q4.5-3.6 9 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><path d="M20 29.5l9 1.4M44 29.5l-9 1.4" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;
      default: return `<circle cx="25.5" cy="34" r="3.3" fill="${INK}"/><circle cx="38.5" cy="34" r="3.3" fill="${INK}"/><circle cx="26.5" cy="33" r="1.1" fill="#fff"/><circle cx="39.5" cy="33" r="1.1" fill="#fff"/>`;
    }
  }
  function mouth(kind) {
    switch (kind) {
      case 'smile': return `<path d="M27 42.5q5 4 10 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
      case 'line': return `<path d="M27.5 43.5h9" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
      case 'grid': return `<rect x="25" y="41" width="14" height="5.6" rx="2" fill="${INK}"/><path d="M29.7 41v5.6M34.3 41v5.6" stroke="${FACE}" stroke-width="1.2"/>`;
      case 'o': return `<circle cx="32" cy="44" r="2.6" fill="${INK}"/>`;
      default: return '';
    }
  }
  function top(kind, y, c1) {
    switch (kind) {
      case 'antenna': return `<path d="M32 ${y}v-6.5" stroke="${FACE}" stroke-width="2.4" stroke-linecap="round"/><circle cx="32" cy="${y - 8}" r="3.2" fill="${FACE}"/><circle cx="32" cy="${y - 8}" r="1.5" fill="${c1}"/>`;
      case 'twin': return `<path d="M25 ${y + 1}l-3.5-7M39 ${y + 1}l3.5-7" stroke="${FACE}" stroke-width="2.4" stroke-linecap="round"/><circle cx="21" cy="${y - 7}" r="2.5" fill="${FACE}"/><circle cx="43" cy="${y - 7}" r="2.5" fill="${FACE}"/>`;
      case 'halo': return `<ellipse cx="32" cy="${y - 6}" rx="11" ry="3" fill="none" stroke="${FACE}" stroke-width="2.2" opacity=".9"/>`;
      case 'spikes': return `<path d="M24 ${y + 3}l2-7 3 5M32 ${y}l0-7M40 ${y + 3}l-2-7-3 5" fill="none" stroke="${FACE}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
      default: return '';
    }
  }

  function nodeAvatar(spec, size = 40, opts = {}) {
    spec = spec || { bg: ['#64748b', '#334155'] };
    const [c1, c2] = spec.bg || ['#64748b', '#334155'];
    const id = 'av' + ++n;
    const h = head(spec.head);
    const r = Math.round(size * 0.27);
    return `<svg class="node-av ${opts.cls || ''}" width="${size}" height="${size}" viewBox="0 0 64 64" style="border-radius:${r}px;clip-path:inset(0 round ${r}px)">
      <defs>
        <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
        <radialGradient id="${id}r" cx=".3" cy=".15" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dde4f0"/></linearGradient>
      </defs>
      <rect width="64" height="64" fill="url(#${id}g)"/>
      <rect width="64" height="64" fill="url(#${id}r)"/>
      ${top(spec.top, h.top, c1)}
      <g fill="rgba(0,0,0,.18)" transform="translate(0 2.2)">${h.el}</g>
      <g fill="url(#${id}f)">${h.el}</g>
      ${eyes(spec.eyes, c1)}
      ${mouth(spec.mouth)}
      ${spec.mouth === 'smile' || spec.eyes === 'wide' ? `<circle cx="20.5" cy="41" r="2.3" fill="${c1}" opacity=".35"/><circle cx="43.5" cy="41" r="2.3" fill="${c1}" opacity=".35"/>` : ''}
      <rect class="av-ring" width="64" height="64"/>
    </svg>`;
  }

  // The group chat tile: four mini bots in a grid.
  function teamAvatar(specs, size = 40) {
    const id = 'tm' + ++n;
    const r = Math.round(size * 0.27);
    const cells = specs.slice(0, 4).map((s, i) => {
      const x = (i % 2) * 32;
      const y = Math.floor(i / 2) * 32;
      const [c1] = s.bg;
      return `<g transform="translate(${x} ${y})"><rect width="32" height="32" fill="${c1}"/><rect x="7" y="9" width="18" height="16" rx="5" fill="#f4f7fc"/><circle cx="12.5" cy="16.5" r="2" fill="${INK}"/><circle cx="19.5" cy="16.5" r="2" fill="${INK}"/><path d="M13.5 21q2.5 2 5 0" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>`;
    });
    return `<svg class="node-av" width="${size}" height="${size}" viewBox="0 0 64 64" style="border-radius:${r}px;clip-path:inset(0 round ${r}px)"><defs><radialGradient id="${id}" cx=".3" cy=".15" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>${cells.join('')}<rect width="64" height="64" fill="url(#${id})"/><path d="M32 0v64M0 32h64" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/><rect class="av-ring" width="64" height="64"/></svg>`;
  }

  // Random spec for new custom nodes.
  const PALETTES = [['#38bdf8', '#1d4ed8'], ['#2dd4bf', '#0f766e'], ['#fb923c', '#c2410c'], ['#f87171', '#b91c1c'], ['#f472b6', '#be185d'], ['#4ade80', '#15803d'], ['#facc15', '#a16207'], ['#a3e635', '#4d7c0f'], ['#94a3b8', '#334155'], ['#22d3ee', '#0e7490'], ['#fbbf24', '#b45309'], ['#60a5fa', '#1e3a8a']];
  const PARTS = { head: ['square', 'round', 'hex', 'tv', 'dome', 'shield'], eyes: ['dots', 'visor', 'wide', 'glasses', 'cyclops', 'squint'], mouth: ['smile', 'line', 'grid', 'o', 'none'], top: ['antenna', 'twin', 'halo', 'spikes', 'none'] };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function randomSpec() {
    return { bg: pick(PALETTES), head: pick(PARTS.head), eyes: pick(PARTS.eyes), mouth: pick(PARTS.mouth), top: pick(PARTS.top) };
  }

  global.NodeAvatars = { nodeAvatar, teamAvatar, randomSpec, PALETTES, PARTS };
})(typeof window !== 'undefined' ? window : globalThis);
