export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
}

const paths = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  book: 'M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z',
  audio: 'M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v8h4v-8Zm16 0h2v8h-4v-8Z',
  repeat: 'M4 7h14l-3-3m5 13H6l3 3M20 7v4M4 17v-4',
  chart: 'M4 3v17h17M8 15l4-5 4 2 5-8',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  sun: 'M12 3V1m0 22v-2M3 12H1m22 0h-2M5 5 3 3m18 18-2-2M5 19l-2 2M21 3l-2 2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  play: 'm8 4 13 8-13 8Z',
  pause: 'M7 4h3v16H7Zm7 0h3v16h-3Z',
  check: 'm5 12 4 4L20 5',
  close: 'm6 6 12 12M6 18 18 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  clock: 'M12 7v5l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  folder: 'M3 6h7l2 2h9v12H3Z',
  flag: 'M5 22V3h13l-2 4 2 5H5',
  spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z'
};

export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`;
}

export function button(action, label, className = 'button', data = '') {
  return `<button type="button" class="${className}" data-action="${action}" ${data}>${label}</button>`;
}

export function formatDate(value, time = false) {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return '—';
  return date.toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric', ...(time ? {hour: '2-digit', minute: '2-digit'} : {})});
}

export function percent(value) {return value === null || value === undefined ? '—' : `${value}%`;}

export function diffHTML(typed, answer) {
  if (!typed) return '<span class="muted">未作答</span>';
  const a = Array.from(String(typed).slice(0, 512)), b = Array.from(String(answer).slice(0, 512));
  const table = Array.from({length: a.length + 1}, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  let i = 0, j = 0, html = '';
  while (i < a.length) {
    if (j < b.length && a[i].toLowerCase() === b[j].toLowerCase()) {html += escapeHTML(a[i++]); j++;}
    else if (j < b.length && table[i][j + 1] > table[i + 1][j]) j++;
    else html += `<mark>${escapeHTML(a[i++])}</mark>`;
  }
  return html;
}
