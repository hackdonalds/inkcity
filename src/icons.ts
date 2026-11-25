/** Hand-inked line icons (24×24, stroked with currentColor). */
const P: Record<string, string> = {
  look: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
  build: '<path d="M4 11.5 12 4.5l8 7"/><path d="M6.2 9.8V20h11.6V9.8"/><path d="M10.2 20v-5h3.6v5"/>',
  brace: '<path d="M13 3.5v17"/><path d="M13 3.5h5v17"/><path d="M4 20.5 13 9"/><path d="M7.5 20.5 13 13.5"/><path d="M2.5 20.5h19"/>',
  bridge: '<path d="M2.5 9h19"/><path d="M4.5 9c0 5 3.3 7 7.5 7s7.5-2 7.5-7"/><path d="M3 9v11M21 9v11"/><path d="M8 9v4.5M12 9v7M16 9v4.5"/>',
  demolish: '<path d="m13.5 4 6.5 6.5-3 3L10.5 7z"/><path d="m11.5 8.5-8 8 3 3 8-8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  frame: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.8a7.5 7.5 0 0 1 0 10.4"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',
  camera: '<path d="M3.5 8h3.5l2-2.8h6L17 8h3.5v11.5h-17z"/><circle cx="12" cy="13.5" r="3.6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.5v.6"/><path d="M12 16.8v.2"/>',
  menu: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  fast: '<path d="M4 6v12l8-6zM12 6v12l8-6z"/>',
  wood: '<path d="M5 8.5h11.5a3.5 3.5 0 0 1 0 7H5"/><ellipse cx="5" cy="12" rx="2" ry="3.5"/><circle cx="16.5" cy="12" r="1.2"/>',
  stone: '<path d="M4 16.5 6.5 9.5l6-3 6.5 3.5 1 6.5-5 3.5H8z"/><path d="m6.5 9.5 5 3 7.5-2.5M11.5 12.5v7"/>',
  tiles: '<path d="M3 15c1.5-3 3-3 4.5 0 1.5-3 3-3 4.5 0 1.5-3 3-3 4.5 0 1.5-3 3-3 4.5 0"/><path d="M3 10c1.5-3 3-3 4.5 0 1.5-3 3-3 4.5 0 1.5-3 3-3 4.5 0 1.5-3 3-3 4.5 0"/><path d="M3 20h18"/>',
  food: '<path d="M12 21V8"/><path d="M12 8c-2-1-3-3-3-5 2 0 3 2 3 5zm0 0c2-1 3-3 3-5-2 0-3 2-3 5z"/><path d="M12 13c-2-.5-4-1-5-3 2-1 4 0 5 3zm0 0c2-.5 4-1 5-3-2-1-4 0-5 3z"/><path d="M12 17.5c-2-.5-4-1-5-3 2-1 4 0 5 3zm0 0c2-.5 4-1 5-3-2-1-4 0-5 3z"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6"/><circle cx="16.5" cy="9" r="2.4"/><path d="M15.5 14.2c3 .1 5 2.3 5 5.8"/>',
  jobs: '<path d="m13.5 4 6.5 6.5-3 3L10.5 7z"/><path d="m11.5 8.5-8 8 3 3 8-8"/>',
  tower: '<path d="M8 20.5V9l4-4.5L16 9v11.5"/><path d="M5.5 20.5h13"/><path d="M11 12h2M11 16h2"/>',
  happy: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0"/><path d="M9 9.5v.5M15 9.5v.5"/>',
  meh: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><path d="M9 9.5v.5M15 9.5v.5"/>',
  sad: '<circle cx="12" cy="12" r="9"/><path d="M8.5 16c1.8-2 5.2-2 7 0"/><path d="M9 9.5v.5M15 9.5v.5"/>',
  scroll: '<path d="M7 4.5h11a2 2 0 0 1 0 4h-1.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5h10"/><path d="M7 4.5a2 2 0 0 0-2 2V17.5"/><path d="M9 9.5h5M9 13h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
};

export function icon(name: string, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

/** Fill every [data-icon] element: icon + optional label from data-label. */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const label = el.dataset.label;
    el.innerHTML = icon(el.dataset.icon!) + (label ? `<span class="lbl">${label}</span>` : '');
  });
}
