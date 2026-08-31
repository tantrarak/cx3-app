// charts.js — tiny dependency-free SVG chart renderers (keeps the PWA fully offline-capable).

const NAVY = '#1a2b4c';
const GREEN = '#22a06b';
const ORANGE = '#e08a2c';
const GRAY = '#c7cdd6';

function escapeAttr(v) {
  return String(v);
}

export function barChartSVG({ labels, values, colors, height = 160, valueFormatter }) {
  const w = 320;
  const h = height;
  const padL = 36;
  const padB = 24;
  const padT = 10;
  const chartW = w - padL - 8;
  const chartH = h - padT - padB;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const n = values.length || 1;
  const gap = 4;
  const barW = Math.max(2, chartW / n - gap);

  let bars = '';
  let xLabels = '';
  const step = Math.max(1, Math.ceil(n / 8));
  values.forEach((v, i) => {
    const barH = (Math.abs(v) / max) * chartH;
    const x = padL + i * (chartW / n);
    const y = padT + (chartH - barH);
    const color = (colors && colors[i]) || NAVY;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"></rect>`;
    if (i % step === 0) {
      xLabels += `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 6}" font-size="8" fill="var(--color-text-muted)" text-anchor="middle">${escapeAttr(labels[i])}</text>`;
    }
  });

  const maxLabel = valueFormatter ? valueFormatter(max) : max;
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" role="img" aria-label="กราฟแท่ง">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="var(--color-border)" stroke-width="1" />
    <line x1="${padL}" y1="${padT + chartH}" x2="${w - 8}" y2="${padT + chartH}" stroke="var(--color-border)" stroke-width="1" />
    <text x="4" y="${padT + 8}" font-size="8" fill="var(--color-text-muted)">${maxLabel}</text>
    ${bars}
    ${xLabels}
  </svg>`;
}

export function lineChartSVG({ labels, values, height = 160, color = ORANGE, valueFormatter }) {
  const w = 320;
  const h = height;
  const padL = 40;
  const padB = 24;
  const padT = 10;
  const chartW = w - padL - 8;
  const chartH = h - padT - padB;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const n = values.length;

  if (n === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg"><text x="${w / 2}" y="${h / 2}" font-size="10" text-anchor="middle" fill="var(--color-text-muted)">ยังไม่มีข้อมูล</text></svg>`;
  }

  const points = values.map((v, i) => {
    const x = n === 1 ? padL : padL + (i / (n - 1)) * chartW;
    const y = padT + chartH - ((v - min) / range) * chartH;
    return [x, y];
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const step = Math.max(1, Math.ceil(n / 6));
  let xLabels = '';
  labels.forEach((lb, i) => {
    if (i % step === 0 || i === n - 1) {
      const [x] = points[i];
      xLabels += `<text x="${x.toFixed(1)}" y="${h - 6}" font-size="8" fill="var(--color-text-muted)" text-anchor="middle">${escapeAttr(lb)}</text>`;
    }
  });

  const maxLabel = valueFormatter ? valueFormatter(max) : max;
  const dots = points.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="${color}"></circle>`).join('');

  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" role="img" aria-label="กราฟเส้น">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="var(--color-border)" stroke-width="1" />
    <line x1="${padL}" y1="${padT + chartH}" x2="${w - 8}" y2="${padT + chartH}" stroke="var(--color-border)" stroke-width="1" />
    <text x="4" y="${padT + 8}" font-size="8" fill="var(--color-text-muted)">${maxLabel}</text>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" />
    ${dots}
    ${xLabels}
  </svg>`;
}

export function progressRingSVG({ percent, size = 140, label = '' }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = c - (clamped / 100) * c;
  const center = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="progress-ring" role="img" aria-label="ความคืบหน้า ${clamped}%">
    <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="var(--color-border)" stroke-width="10"></circle>
    <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${GREEN}" stroke-width="10"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 ${center} ${center})"></circle>
    <text x="${center}" y="${center - 2}" text-anchor="middle" font-size="22" font-weight="700" fill="var(--color-text)">${clamped.toFixed(0)}%</text>
    <text x="${center}" y="${center + 18}" text-anchor="middle" font-size="9" fill="var(--color-text-muted)">${escapeAttr(label)}</text>
  </svg>`;
}
