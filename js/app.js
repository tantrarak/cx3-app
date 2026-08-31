import * as db from './db.js';
import * as calc from './calc.js';
import * as charts from './charts.js';
import * as drive from './drive.js';

const $view = document.getElementById('app-view');
const $nav = document.getElementById('bottom-nav');
const $modalRoot = document.getElementById('modal-root');
const $toastRoot = document.getElementById('toast-root');
const $headerRight = document.getElementById('header-right');

const state = {
  settings: null,
  installments: [],
  currentView: 'dashboard',
  historyFilters: { q: '', month: '', status: '' },
  objectURLs: [],
};

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function trackURL(url) {
  state.objectURLs.push(url);
  return url;
}

function revokeAllURLs() {
  for (const u of state.objectURLs) URL.revokeObjectURL(u);
  state.objectURLs = [];
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $toastRoot.innerHTML = '';
  $toastRoot.appendChild(el);
  setTimeout(() => { el.remove(); }, 2700);
}

function closeModal() {
  revokeAllURLs();
  $modalRoot.innerHTML = '';
}

function openModal(innerHTML, { center = false } = {}) {
  $modalRoot.innerHTML = `<div class="modal-overlay${center ? ' center' : ''}" id="modal-overlay">
    <div class="modal-sheet">${center ? '' : '<div class="modal-handle"></div>'}${innerHTML}</div>
  </div>`;
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}

// ---------- default data ----------

function buildDefaultSettings() {
  const today = new Date();
  const dueDay = 5;
  let year = today.getFullYear();
  let month = today.getMonth();
  if (today.getDate() > dueDay) month += 1;
  const firstDueDate = calc.toISODate(new Date(year, month, dueDay));
  return {
    monthlyAmount: 6096.59,
    totalInstallments: 72,
    firstDueDate,
    dueDay,
    principalFromFinance: null,
    overpaymentPolicyDefault: 'accumulate',
    notifyEnabled: false,
    notifyDaysBefore: 3,
    driveEnabled: false,
    driveClientId: '',
    driveFolderId: '1i1JHSlhwWLesdjTT6cA3_YBXILGI-zv4',
  };
}

async function ensureInitialized() {
  let settings = await db.getSettings();
  if (!settings) {
    settings = buildDefaultSettings();
    await db.saveSettings(settings);
  }
  let installments = await db.getAllInstallments();
  if (installments.length === 0) {
    installments = calc.generateSchedule(settings);
    await db.bulkPutInstallments(installments);
  }
  state.settings = settings;
  state.installments = installments;
}

async function reloadFromDB() {
  state.settings = await db.getSettings();
  state.installments = await db.getAllInstallments();
}

// ---------- routing ----------

function navigateTo(view) {
  state.currentView = view;
  Array.from($nav.querySelectorAll('button')).forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  render();
  window.scrollTo(0, 0);
}

function render() {
  switch (state.currentView) {
    case 'dashboard': return renderDashboard();
    case 'schedule': return renderSchedule();
    case 'history': return renderHistory();
    case 'planning': return renderPlanning();
    case 'summary': return renderSummary();
    case 'settings': return renderSettings();
    default: return renderDashboard();
  }
}

// ---------- Dashboard ----------

function renderDashboard() {
  const { settings, installments } = state;
  const totals = calc.computeTotals(installments, settings);
  const next = totals.nextInstallment;

  let nextBlock = '';
  if (next) {
    const days = totals.daysUntilNextDue;
    const daysText = days === 0 ? 'ถึงกำหนดวันนี้' : days > 0 ? `เหลืออีก ${days} วัน ถึงกำหนดชำระ` : `เลยกำหนดมาแล้ว ${Math.abs(days)} วัน`;
    const status = calc.computeStatus(next);
    nextBlock = `
      <div class="card">
        <div class="card-title">งวดถัดไป: งวดที่ ${next.installmentNumber}</div>
        <div class="card-value small">${calc.fmtMoney(next.scheduledAmount)}<span class="unit">บาท</span></div>
        <p class="text-muted mt-8">ครบกำหนด ${calc.fmtDate(next.dueDate)} · ${daysText}</p>
        <span class="badge badge-${status}">${calc.STATUS_LABEL[status]}</span>
        <div class="mt-12">
          <button class="btn btn-success" data-action="open-installment" data-n="${next.installmentNumber}">บันทึกการชำระเงิน</button>
        </div>
      </div>`;
  } else {
    nextBlock = `<div class="card"><p class="text-muted">ผ่อนครบทุกงวดแล้ว 🎉</p></div>`;
  }

  $view.innerHTML = `
    <div class="hero-card">
      <div class="card-title">ค่างวดประจำเดือน</div>
      <div class="card-value">${calc.fmtMoney(settings.monthlyAmount)}<span class="unit">บาท</span></div>
      <div class="hero-row">
        <span class="chip">งวดที่ชำระแล้ว ${totals.paidCount}/${settings.totalInstallments}</span>
        <span class="chip">เหลือ ${totals.remainingCount} งวด</span>
      </div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${totals.progressPercent}%"></div></div>
    </div>

    ${nextBlock}

    <div class="grid-2">
      <div class="card">
        <div class="card-title">ยอดที่ชำระไปแล้วทั้งหมด</div>
        <div class="card-value small">${calc.fmtMoney(totals.totalPaid)}</div>
      </div>
      <div class="card">
        <div class="card-title">ยอดที่เหลือทั้งหมด</div>
        <div class="card-value small">${calc.fmtMoney(totals.totalRemaining)}</div>
      </div>
      <div class="card">
        <div class="card-title">จ่ายเกินค่างวดสะสม</div>
        <div class="card-value small" style="color:var(--color-orange)">${calc.fmtMoney(totals.totalOverpaid)}</div>
      </div>
      <div class="card">
        <div class="card-title">เงินต้นคงเหลือ (ล่าสุดที่กรอก)</div>
        <div class="card-value small">${totals.latestRemainingPrincipal != null ? calc.fmtMoney(totals.latestRemainingPrincipal) : '<span class="text-muted" style="font-size:14px">ยังไม่ได้กรอก</span>'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">ความคืบหน้าการผ่อนชำระ</div>
      <div class="progress-bar-track light"><div class="progress-bar-fill" style="width:${totals.progressPercent}%"></div></div>
      <p class="text-muted mt-8">${totals.progressPercent.toFixed(1)}% ของสัญญา ${settings.totalInstallments} งวด</p>
    </div>
  `;
}

// ---------- Schedule (72 installments) ----------

function renderSchedule() {
  const rows = state.installments.map((inst) => {
    const status = calc.computeStatus(inst);
    const diff = calc.computeDiff(inst);
    const diffText = diff == null ? '-' : (diff > 0 ? '+' : '') + calc.fmtMoney(diff);
    return `<tr class="row-clickable" data-action="open-installment" data-n="${inst.installmentNumber}">
      <td>${inst.installmentNumber}</td>
      <td>${calc.fmtDate(inst.dueDate)}</td>
      <td>${calc.fmtMoney(inst.scheduledAmount)}</td>
      <td>${inst.paidAmount != null ? calc.fmtMoney(inst.paidAmount) : '-'}</td>
      <td>${diffText}</td>
      <td><span class="badge badge-${status}">${calc.STATUS_LABEL[status]}</span></td>
      <td>${(inst.slips && inst.slips.length) ? '📎' + inst.slips.length : '-'}</td>
    </tr>`;
  }).join('');

  $view.innerHTML = `
    <h2 class="section-title" style="margin-top:0">ตารางผ่อน ${state.settings.totalInstallments} งวด</h2>
    <div class="table-scroll">
      <table class="installment-table">
        <thead><tr>
          <th>งวด</th><th>วันครบกำหนด</th><th>ค่างวด</th><th>จ่ายจริง</th><th>ส่วนต่าง</th><th>สถานะ</th><th>สลิป</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ---------- Installment detail modal ----------

function driveStatusBadge(status) {
  if (status === 'uploaded') return '<span class="slip-drive-badge ok" title="อัปโหลดขึ้น Google Drive แล้ว">☁️✓</span>';
  if (status === 'uploading') return '<span class="slip-drive-badge pending" title="กำลังอัปโหลด...">☁️⋯</span>';
  if (status === 'failed' || status === 'pending') return '<span class="slip-drive-badge failed" title="ยังไม่ได้อัปโหลดขึ้น Google Drive">☁️!</span>';
  return '';
}

function slipThumbHTML(inst) {
  const items = (inst.slips || []).map((s, idx) => {
    const url = trackURL(URL.createObjectURL(s.blob));
    return `<div class="slip-thumb" data-action="view-slip" data-n="${inst.installmentNumber}" data-idx="${idx}">
      <img src="${url}" alt="สลิปงวด ${inst.installmentNumber}">
      ${driveStatusBadge(s.driveStatus)}
      <button class="slip-remove" data-action="remove-slip" data-n="${inst.installmentNumber}" data-idx="${idx}" title="ลบสลิป">✕</button>
    </div>`;
  }).join('');
  return `<div class="slip-grid" id="slip-grid">
    ${items}
    <label class="slip-add-btn">
      📷<span class="txt">เพิ่มสลิป</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" id="slip-file-input" data-n="${inst.installmentNumber}" multiple>
    </label>
  </div>`;
}

function renderInstallmentModal(n) {
  const inst = state.installments.find((i) => i.installmentNumber === n);
  if (!inst) return;
  const status = calc.computeStatus(inst);
  const diff = calc.computeDiff(inst);

  const html = `
    <div class="modal-header">
      <h3>งวดที่ ${inst.installmentNumber} <span class="badge badge-${status}">${calc.STATUS_LABEL[status]}</span></h3>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <p class="text-muted">ครบกำหนด ${calc.fmtDate(inst.dueDate)} · ค่างวด ${calc.fmtMoney(inst.scheduledAmount)} บาท</p>

    <form id="installment-form" class="mt-16">
      <div class="field">
        <label>วันที่จ่ายจริง</label>
        <input type="date" name="paidDate" value="${inst.paidDate || ''}">
      </div>
      <div class="field">
        <label>เวลาที่โอน</label>
        <input type="time" name="paidTime" value="${inst.paidTime || ''}">
      </div>
      <div class="field" id="field-paidAmount">
        <label>จำนวนเงินที่จ่าย</label>
        <input type="number" step="0.01" min="0" name="paidAmount" id="input-paidAmount" value="${inst.paidAmount != null ? inst.paidAmount : ''}" placeholder="${inst.scheduledAmount}">
        <div class="hint" id="diff-hint">${diff == null ? '' : diffHintText(diff)}</div>
        <div class="error">กรุณากรอกจำนวนเงินให้ถูกต้อง และระบุวันที่จ่ายด้วย</div>
      </div>
      <div class="field" id="field-allocation" style="display:${diff && diff > 0 ? 'block' : 'none'}">
        <label>เงินที่จ่ายเกิน ต้องการบันทึกเป็น</label>
        <select name="overpaymentAllocation">
          <option value="accumulate" ${inst.overpaymentAllocation === 'accumulate' ? 'selected' : ''}>เงินจ่ายเกินสะสม</option>
          <option value="principal" ${inst.overpaymentAllocation === 'principal' ? 'selected' : ''}>เงินชำระเงินต้นเพิ่ม</option>
          <option value="advance" ${inst.overpaymentAllocation === 'advance' ? 'selected' : ''}>เงินล่วงหน้าสำหรับงวดถัดไป</option>
        </select>
        <div class="hint">ระบบจะไม่นำเงินนี้ไปลดเงินต้นให้อัตโนมัติ ขึ้นอยู่กับเงื่อนไขจริงของไฟแนนซ์</div>
      </div>
      <div class="field">
        <label>เงินต้นที่เหลือ (ถ้าทราบ)</label>
        <input type="number" step="0.01" min="0" name="remainingPrincipal" value="${inst.remainingPrincipal != null ? inst.remainingPrincipal : ''}">
      </div>
      <div class="field">
        <label>ดอกเบี้ยที่เหลือ (ถ้าทราบ)</label>
        <input type="number" step="0.01" min="0" name="remainingInterest" value="${inst.remainingInterest != null ? inst.remainingInterest : ''}">
      </div>
      <div class="field">
        <label>หมายเหตุ</label>
        <textarea name="note" rows="2">${inst.note || ''}</textarea>
      </div>

      <div class="field">
        <label>สลิปการโอน</label>
        ${slipThumbHTML(inst)}
      </div>

      <button type="submit" class="btn btn-success">บันทึกการชำระเงิน</button>
    </form>
  `;
  openModal(html);
  attachInstallmentModalHandlers(n);
}

function diffHintText(diff) {
  if (Math.abs(diff) < 0.005) return 'ส่วนต่าง: 0 บาท (ตรงตามค่างวด)';
  if (diff > 0) return `ส่วนต่าง: จ่ายเกิน ${calc.fmtMoney(diff)} บาท`;
  return `ส่วนต่าง: จ่ายขาด ${calc.fmtMoney(Math.abs(diff))} บาท`;
}

function attachInstallmentModalHandlers(n) {
  const form = document.getElementById('installment-form');
  const amountInput = document.getElementById('input-paidAmount');
  const hint = document.getElementById('diff-hint');
  const allocField = document.getElementById('field-allocation');

  function recalc() {
    const inst = state.installments.find((i) => i.installmentNumber === n);
    const val = parseFloat(amountInput.value);
    if (Number.isNaN(val)) { hint.textContent = ''; allocField.style.display = 'none'; return; }
    const diff = calc.roundMoney(val - inst.scheduledAmount);
    hint.textContent = diffHintText(diff);
    allocField.style.display = diff > 0 ? 'block' : 'none';
  }
  amountInput.addEventListener('input', recalc);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const paidAmountRaw = fd.get('paidAmount');
    const paidDate = fd.get('paidDate') || null;
    const fieldWrap = document.getElementById('field-paidAmount');

    const inst = state.installments.find((i) => i.installmentNumber === n);
    let paidAmount = null;
    if (paidAmountRaw !== '' && paidAmountRaw != null) {
      paidAmount = parseFloat(paidAmountRaw);
      if (Number.isNaN(paidAmount) || paidAmount < 0 || !paidDate) {
        fieldWrap.classList.add('has-error');
        return;
      }
    }
    fieldWrap.classList.remove('has-error');

    inst.paidAmount = paidAmount;
    inst.paidDate = paidAmount != null ? paidDate : (paidDate || null);
    inst.paidTime = fd.get('paidTime') || null;
    inst.note = fd.get('note') || '';
    const rp = fd.get('remainingPrincipal');
    const ri = fd.get('remainingInterest');
    inst.remainingPrincipal = rp !== '' ? parseFloat(rp) : null;
    inst.remainingInterest = ri !== '' ? parseFloat(ri) : null;
    const diff = paidAmount != null ? calc.roundMoney(paidAmount - inst.scheduledAmount) : null;
    inst.overpaymentAllocation = (diff && diff > 0) ? fd.get('overpaymentAllocation') : inst.overpaymentAllocation;

    await db.saveInstallment(inst);
    await reloadFromDB();
    closeModal();
    showToast(`บันทึกงวดที่ ${n} เรียบร้อย`);
    render();
  });

  document.getElementById('slip-file-input').addEventListener('change', (e) => handleSlipFiles(n, e.target.files));
}

const ALLOWED_SLIP_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function handleSlipFiles(n, fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;
  const inst = state.installments.find((i) => i.installmentNumber === n);
  inst.slips = inst.slips || [];
  const newSlips = [];
  for (const file of files) {
    if (!ALLOWED_SLIP_TYPES.includes(file.type)) {
      showToast('รองรับเฉพาะไฟล์ JPG, PNG, WEBP เท่านั้น');
      continue;
    }
    const slip = { id: uuid(), mimeType: file.type, fileName: file.name, uploadedAt: new Date().toISOString(), blob: file, driveStatus: null };
    inst.slips.push(slip);
    newSlips.push(slip);
  }
  await db.saveInstallment(inst);
  await reloadFromDB();
  refreshSlipGrid(n);
  showToast('เพิ่มสลิปเรียบร้อย');

  const s = state.settings;
  if (s.driveEnabled && s.driveClientId && s.driveFolderId) {
    for (const slip of newSlips) uploadSlipToDrive(n, slip.id);
  }
}

function refreshSlipGrid(n) {
  const inst = state.installments.find((i) => i.installmentNumber === n);
  const grid = document.getElementById('slip-grid');
  if (!grid) return;
  grid.outerHTML = slipThumbHTML(inst);
  document.getElementById('slip-file-input').addEventListener('change', (e) => handleSlipFiles(n, e.target.files));
}

async function uploadSlipToDrive(n, slipId) {
  const s = state.settings;
  const inst = state.installments.find((i) => i.installmentNumber === n);
  const slip = inst && inst.slips.find((x) => x.id === slipId);
  if (!slip) return;

  if (!drive.isConnected()) {
    slip.driveStatus = 'pending';
    await db.saveInstallment(inst);
    refreshSlipGrid(n);
    return;
  }

  slip.driveStatus = 'uploading';
  refreshSlipGrid(n);
  try {
    const ext = slip.mimeType.split('/')[1] || 'jpg';
    const fileName = `cx3-slip-installment${n}-${slip.uploadedAt.replace(/[:.]/g, '-')}.${ext}`;
    const result = await drive.uploadFileToFolder({
      clientId: s.driveClientId,
      folderId: s.driveFolderId,
      file: slip.blob,
      fileName,
    });
    slip.driveStatus = 'uploaded';
    slip.driveFileId = result.id;
    slip.driveWebViewLink = result.webViewLink;
    showToast(`อัปโหลดสลิปงวดที่ ${n} ขึ้น Google Drive แล้ว`);
  } catch (err) {
    slip.driveStatus = 'failed';
    showToast('อัปโหลดขึ้น Google Drive ไม่สำเร็จ ลองใหม่ได้ในหน้าตั้งค่า');
    console.warn('Drive upload failed', err);
  }
  await db.saveInstallment(inst);
  await reloadFromDB();
  refreshSlipGrid(n);
}

async function syncPendingSlipsToDrive() {
  const s = state.settings;
  if (!s.driveEnabled || !s.driveClientId || !s.driveFolderId) {
    showToast('กรุณาเปิดใช้งานและตั้งค่า Google Drive ก่อน');
    return;
  }
  if (!drive.isConnected()) {
    showToast('กรุณาเชื่อมต่อ Google Drive ก่อน');
    return;
  }
  let count = 0;
  for (const inst of state.installments) {
    for (const slip of inst.slips || []) {
      if (slip.driveStatus !== 'uploaded') {
        count++;
        await uploadSlipToDrive(inst.installmentNumber, slip.id);
      }
    }
  }
  showToast(count > 0 ? `กำลังอัปโหลด ${count} รูปที่ค้างอยู่` : 'ไม่มีรูปที่ค้างอัปโหลด');
}

async function removeSlip(n, idx) {
  const inst = state.installments.find((i) => i.installmentNumber === n);
  if (!inst || !inst.slips) return;
  inst.slips.splice(idx, 1);
  await db.saveInstallment(inst);
  await reloadFromDB();
  refreshSlipGrid(n);
  showToast('ลบสลิปแล้ว');
}

function viewSlip(n, idx) {
  const inst = state.installments.find((i) => i.installmentNumber === n);
  const slip = inst.slips[idx];
  if (!slip) return;
  const url = trackURL(URL.createObjectURL(slip.blob));
  const box = document.createElement('div');
  box.className = 'lightbox';
  const driveLink = slip.driveWebViewLink
    ? `<a href="${slip.driveWebViewLink}" target="_blank" rel="noopener" class="lightbox-drive-link">เปิดใน Google Drive ↗</a>`
    : '';
  box.innerHTML = `
    <button class="lightbox-close" data-action="close-lightbox">✕</button>
    <img src="${url}" alt="สลิปงวด ${n}">
    ${driveLink}
  `;
  document.body.appendChild(box);
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.dataset.action === 'close-lightbox') box.remove();
  });

  showToast(`งวดที่ ${n} · ${calc.fmtDate(inst.paidDate)} ${inst.paidTime || ''} · ${inst.paidAmount != null ? calc.fmtMoney(inst.paidAmount) + ' บาท' : ''}`);
}

// ---------- History ----------

function monthKey(iso) {
  return iso ? iso.slice(0, 7) : '';
}

function renderHistory() {
  const { installments, historyFilters: f } = state;
  const months = Array.from(new Set(installments.map((i) => monthKey(i.dueDate)))).sort();

  const filtered = installments.filter((inst) => {
    const status = calc.computeStatus(inst);
    if (f.status && status !== f.status) return false;
    if (f.month && monthKey(inst.dueDate) !== f.month) return false;
    if (f.q) {
      const q = f.q.trim();
      const matchesNum = String(inst.installmentNumber).includes(q);
      const matchesAmount = inst.paidAmount != null && String(inst.paidAmount).includes(q);
      if (!matchesNum && !matchesAmount) return false;
    }
    return true;
  });

  const items = filtered.map((inst) => {
    const status = calc.computeStatus(inst);
    const diff = calc.computeDiff(inst);
    let amountLine = calc.fmtMoney(inst.scheduledAmount) + ' บาท';
    if (inst.paidAmount != null) {
      amountLine = calc.fmtMoney(inst.paidAmount) + ' บาท';
      if (diff && Math.abs(diff) > 0.005) {
        amountLine += diff > 0 ? ` (+เกิน ${calc.fmtMoney(diff)})` : ` (-ขาด ${calc.fmtMoney(Math.abs(diff))})`;
      }
    }
    const hasSlip = inst.slips && inst.slips.length > 0;
    return `<div class="history-item">
      <div>
        <div class="h-num">งวดที่ ${inst.installmentNumber}</div>
        <div class="h-meta">${calc.fmtDate(inst.paidDate) !== '-' ? 'ชำระ ' + calc.fmtDate(inst.paidDate) : 'ครบกำหนด ' + calc.fmtDate(inst.dueDate)}</div>
        <span class="badge badge-${status}">${calc.STATUS_LABEL[status]}</span>
      </div>
      <div style="text-align:right">
        <div class="h-amount">${amountLine}</div>
        <button class="btn btn-outline btn-sm mt-8" data-action="open-installment" data-n="${inst.installmentNumber}">${hasSlip ? 'ดูสลิป' : 'เปิดงวด'}</button>
      </div>
    </div>`;
  }).join('') || `<div class="empty-state"><div class="emoji">🔍</div>ไม่พบรายการที่ตรงกับตัวกรอง</div>`;

  $view.innerHTML = `
    <h2 class="section-title" style="margin-top:0">ประวัติการชำระ</h2>
    <div class="filter-bar">
      <input type="search" id="hist-q" placeholder="ค้นหางวด/จำนวนเงิน" value="${f.q}">
      <select id="hist-month">
        <option value="">ทุกเดือน</option>
        ${months.map((m) => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <select id="hist-status">
        <option value="">ทุกสถานะ</option>
        ${Object.entries(calc.STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    ${items}
  `;

  document.getElementById('hist-q').addEventListener('input', (e) => { state.historyFilters.q = e.target.value; renderHistory(); });
  document.getElementById('hist-month').addEventListener('change', (e) => { state.historyFilters.month = e.target.value; renderHistory(); });
  document.getElementById('hist-status').addEventListener('change', (e) => { state.historyFilters.status = e.target.value; renderHistory(); });
}

// ---------- Planning ----------

function renderPlanning() {
  const { settings, installments } = state;
  const totals = calc.computeTotals(installments, settings);

  $view.innerHTML = `
    <h2 class="section-title" style="margin-top:0">วางแผนการผ่อน</h2>
    <div class="card">
      <div class="field">
        <label>เดือนนี้ฉันสามารถจ่ายได้ (บาท)</label>
        <input type="number" step="0.01" min="0" id="plan-amount" placeholder="เช่น 7000">
      </div>
      <button class="btn btn-primary" id="plan-calc-btn">คำนวณ</button>
      <div id="plan-result" class="mt-16"></div>
    </div>
    <div class="card">
      <p class="text-muted">⚠️ หมายเหตุ: การจ่ายเกินค่างวดจะไม่ถูกนำไปลดเงินต้นหรือย่นระยะเวลาผ่อนโดยอัตโนมัติ การคำนวณจริงขึ้นอยู่กับเงื่อนไขของไฟแนนซ์ ตัวเลขด้านบนเป็นเพียงการประมาณการหากจ่ายจำนวนเท่ากันทุกเดือนตามจำนวนงวดที่เหลือในสัญญาปัจจุบัน (${totals.remainingCount} งวด)</p>
    </div>
  `;

  document.getElementById('plan-calc-btn').addEventListener('click', () => {
    const amount = parseFloat(document.getElementById('plan-amount').value);
    const resultEl = document.getElementById('plan-result');
    if (Number.isNaN(amount) || amount < 0) {
      resultEl.innerHTML = `<p style="color:var(--color-red)">กรุณากรอกจำนวนเงินให้ถูกต้อง</p>`;
      return;
    }
    const plan = calc.planExtraPayment(settings.monthlyAmount, amount, totals.remainingCount);
    resultEl.innerHTML = `
      <div class="summary-stat-row"><span>ค่างวดปกติ</span><span class="val">${calc.fmtMoney(settings.monthlyAmount)}</span></div>
      <div class="summary-stat-row"><span>${plan.extra >= 0 ? 'จ่ายเพิ่ม' : 'จ่ายน้อยกว่าค่างวด'}</span><span class="val" style="color:${plan.extra >= 0 ? 'var(--color-orange)' : 'var(--color-red)'}">${calc.fmtMoney(Math.abs(plan.extra))}</span></div>
      <div class="summary-stat-row"><span>ถ้าจ่ายเท่านี้ทุกเดือน (${totals.remainingCount} งวดที่เหลือ) เงินเพิ่มสะสม</span><span class="val">${calc.fmtMoney(plan.extraAccumulated)}</span></div>
      <div class="summary-stat-row"><span>รวมเงินที่ต้องใช้ทั้งหมด (${totals.remainingCount} งวด)</span><span class="val">${calc.fmtMoney(plan.totalIfEveryMonth)}</span></div>
    `;
  });
}

// ---------- Summary ----------

function renderSummary() {
  const { settings, installments } = state;
  const totals = calc.computeTotals(installments, settings);

  const paidInstallments = installments.filter((i) => i.paidAmount != null).sort((a, b) => a.installmentNumber - b.installmentNumber);
  const monthlyLabels = paidInstallments.map((i) => String(i.installmentNumber));
  const monthlyValues = paidInstallments.map((i) => i.paidAmount);
  const monthlyColors = paidInstallments.map((i) => {
    const d = calc.computeDiff(i);
    return d > 0.005 ? '#e08a2c' : '#22a06b';
  });

  let cum = 0;
  const cumValues = paidInstallments.map((i) => {
    const d = calc.computeDiff(i) || 0;
    cum = calc.roundMoney(cum + Math.max(0, d));
    return cum;
  });

  $view.innerHTML = `
    <h2 class="section-title" style="margin-top:0">สรุปภาพรวม</h2>

    <div class="card">
      <div class="card-title">ยอดรวมตามสัญญา (${calc.fmtMoney(settings.monthlyAmount)} × ${settings.totalInstallments} งวด)</div>
      <div class="card-value small">${calc.fmtMoney(totals.totalContract)}</div>
    </div>

    <div class="card">
      <div class="summary-stat-row"><span>ยอดที่ควรจ่ายจนถึงปัจจุบัน</span><span class="val">${calc.fmtMoney(totals.dueToDate)}</span></div>
      <div class="summary-stat-row"><span>ยอดที่จ่ายจริง</span><span class="val">${calc.fmtMoney(totals.totalPaid)}</span></div>
      <div class="summary-stat-row"><span>${totals.shortfallToDate > 0 ? 'ขาดอยู่' : 'จ่ายเกินสุทธิ'}</span><span class="val" style="color:${totals.shortfallToDate > 0 ? 'var(--color-red)' : 'var(--color-green)'}">${calc.fmtMoney(Math.abs(totals.shortfallToDate))}</span></div>
      <div class="summary-stat-row"><span>ยอดค่างวดที่เหลือ</span><span class="val">${calc.fmtMoney(totals.totalRemaining)}</span></div>
      <div class="summary-stat-row"><span>จ่ายเกินสะสม (รวม)</span><span class="val">${calc.fmtMoney(totals.totalOverpaid)}</span></div>
    </div>

    <div class="card">
      <div class="card-title">การจัดสรรเงินจ่ายเกิน</div>
      <div class="summary-stat-row"><span>เงินจ่ายเกินสะสม</span><span class="val">${calc.fmtMoney(totals.byAllocation.accumulate)}</span></div>
      <div class="summary-stat-row"><span>เงินชำระเงินต้นเพิ่ม</span><span class="val">${calc.fmtMoney(totals.byAllocation.principal)}</span></div>
      <div class="summary-stat-row"><span>เงินล่วงหน้าสำหรับงวดถัดไป</span><span class="val">${calc.fmtMoney(totals.byAllocation.advance)}</span></div>
    </div>

    <div class="card">
      <div class="card-title">ความคืบหน้าการผ่อน ${settings.totalInstallments} งวด</div>
      <div class="chart-row">${charts.progressRingSVG({ percent: totals.progressPercent, label: `${totals.paidCount}/${settings.totalInstallments} งวด` })}</div>
    </div>

    <div class="card">
      <div class="card-title">ยอดชำระรายงวด</div>
      ${monthlyValues.length ? charts.barChartSVG({ labels: monthlyLabels, values: monthlyValues, colors: monthlyColors, valueFormatter: calc.fmtMoney }) : '<p class="text-muted">ยังไม่มีข้อมูลการชำระ</p>'}
    </div>

    <div class="card">
      <div class="card-title">ยอดจ่ายเกินสะสม</div>
      ${cumValues.length ? charts.lineChartSVG({ labels: monthlyLabels, values: cumValues, valueFormatter: calc.fmtMoney }) : '<p class="text-muted">ยังไม่มีข้อมูลการจ่ายเกิน</p>'}
    </div>
  `;
}

// ---------- Settings ----------

function renderSettings() {
  const s = state.settings;
  $view.innerHTML = `
    <h2 class="section-title" style="margin-top:0">ตั้งค่า</h2>
    <form id="settings-form" class="card">
      <div class="field">
        <label>ค่างวดต่อเดือน (บาท)</label>
        <input type="number" step="0.01" min="0.01" name="monthlyAmount" value="${s.monthlyAmount}" required>
        <div class="error">กรุณากรอกค่างวดให้ถูกต้อง</div>
      </div>
      <div class="field">
        <label>จำนวนงวดทั้งหมด</label>
        <input type="number" step="1" min="1" max="999" name="totalInstallments" value="${s.totalInstallments}" required>
        <div class="error">กรุณากรอกจำนวนงวดให้ถูกต้อง (1-999)</div>
      </div>
      <div class="field">
        <label>วันครบกำหนดงวดแรก (เดือน/ปี)</label>
        <input type="date" name="firstDueDate" value="${s.firstDueDate}" required>
      </div>
      <div class="field">
        <label>วันที่ครบกำหนดของทุกเดือน</label>
        <input type="number" min="1" max="31" name="dueDay" value="${s.dueDay}" required>
        <div class="hint">เช่น 5 หมายถึงวันที่ 5 ของทุกเดือน</div>
      </div>
      <div class="field">
        <label>ยอดเงินต้นจากไฟแนนซ์ (ถ้าทราบ)</label>
        <input type="number" step="0.01" min="0" name="principalFromFinance" value="${s.principalFromFinance != null ? s.principalFromFinance : ''}">
      </div>
      <div class="field">
        <label>นโยบายเริ่มต้นสำหรับเงินจ่ายเกิน</label>
        <select name="overpaymentPolicyDefault">
          <option value="accumulate" ${s.overpaymentPolicyDefault === 'accumulate' ? 'selected' : ''}>เงินจ่ายเกินสะสม</option>
          <option value="principal" ${s.overpaymentPolicyDefault === 'principal' ? 'selected' : ''}>เงินชำระเงินต้นเพิ่ม</option>
          <option value="advance" ${s.overpaymentPolicyDefault === 'advance' ? 'selected' : ''}>เงินล่วงหน้าสำหรับงวดถัดไป</option>
        </select>
      </div>
      <div class="field">
        <label><input type="checkbox" name="notifyEnabled" ${s.notifyEnabled ? 'checked' : ''}> เปิดการแจ้งเตือนก่อนถึงกำหนดชำระ</label>
      </div>
      <div class="field">
        <label>แจ้งเตือนล่วงหน้ากี่วัน</label>
        <input type="number" min="0" max="30" name="notifyDaysBefore" value="${s.notifyDaysBefore}">
      </div>
      <button type="submit" class="btn btn-primary">บันทึกการตั้งค่า</button>
    </form>

    <div class="card">
      <button class="btn btn-outline" id="btn-request-notif">ขอสิทธิ์การแจ้งเตือน (Notification)</button>
    </div>

    <h3 class="section-title">สำรองสลิปขึ้น Google Drive</h3>
    <form id="drive-settings-form" class="card">
      <div class="field">
        <label><input type="checkbox" name="driveEnabled" ${s.driveEnabled ? 'checked' : ''}> เปิดใช้งานอัปโหลดสลิปไป Google Drive อัตโนมัติ</label>
      </div>
      <div class="field">
        <label>Google OAuth Client ID</label>
        <input type="text" name="driveClientId" value="${s.driveClientId || ''}" placeholder="xxxxxxxx.apps.googleusercontent.com">
        <div class="hint">สร้างได้จาก Google Cloud Console (ทำครั้งเดียว)</div>
      </div>
      <div class="field">
        <label>Folder ID ปลายทางใน Google Drive</label>
        <input type="text" name="driveFolderId" value="${s.driveFolderId || ''}">
      </div>
      <button type="submit" class="btn btn-outline">บันทึกการตั้งค่า Google Drive</button>
    </form>
    <div class="card">
      <div id="drive-status" class="text-muted"></div>
      <div class="btn-block-row mt-12">
        <button class="btn btn-primary" id="btn-drive-connect">เชื่อมต่อ Google Drive</button>
        <button class="btn btn-outline" id="btn-drive-sync">ซิงก์รูปที่ค้างอยู่</button>
      </div>
    </div>

    <h3 class="section-title">ข้อมูล / สำรองข้อมูล</h3>
    <div class="card settings-list">
      <div class="settings-item">
        <div><div class="label">Export ตารางผ่อนเป็น CSV</div><div class="desc">สำหรับเปิดใน Excel</div></div>
        <button class="btn btn-outline btn-sm" id="btn-export-csv">Export CSV</button>
      </div>
      <div class="settings-item">
        <div><div class="label">สำรองข้อมูลทั้งหมด (JSON)</div><div class="desc">รวมรูปสลิปทั้งหมด</div></div>
        <button class="btn btn-outline btn-sm" id="btn-export-json">Backup JSON</button>
      </div>
      <div class="settings-item">
        <div><div class="label">กู้คืนข้อมูลจาก JSON</div><div class="desc">จะเขียนทับข้อมูลปัจจุบันทั้งหมด</div></div>
        <label class="btn btn-outline btn-sm" style="cursor:pointer">เลือกไฟล์<input type="file" accept="application/json" id="btn-import-json" style="display:none"></label>
      </div>
    </div>

    <div class="danger-zone mt-16">
      <h4>ลบข้อมูลทั้งหมด</h4>
      <p class="text-muted">การกระทำนี้ไม่สามารถย้อนกลับได้ ระบบจะให้ยืนยัน 2 ขั้นตอน</p>
      <button class="btn btn-danger mt-12" id="btn-reset">รีเซ็ตข้อมูลทั้งหมด</button>
    </div>
  `;

  document.getElementById('settings-form').addEventListener('submit', onSaveSettings);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-import-json').addEventListener('change', onImportJSON);
  document.getElementById('btn-reset').addEventListener('click', confirmResetStep1);
  document.getElementById('btn-request-notif').addEventListener('click', async () => {
    if (!('Notification' in window)) { showToast('เบราว์เซอร์นี้ไม่รองรับ Notification'); return; }
    const perm = await Notification.requestPermission();
    showToast(perm === 'granted' ? 'เปิดการแจ้งเตือนสำเร็จ' : 'ไม่ได้รับสิทธิ์การแจ้งเตือน');
  });

  document.getElementById('drive-settings-form').addEventListener('submit', onSaveDriveSettings);
  document.getElementById('btn-drive-connect').addEventListener('click', onDriveConnect);
  document.getElementById('btn-drive-sync').addEventListener('click', syncPendingSlipsToDrive);
  updateDriveStatusUI();
}

function updateDriveStatusUI() {
  const el = document.getElementById('drive-status');
  if (!el) return;
  if (drive.isConnected()) {
    const mins = Math.ceil(drive.msUntilExpiry() / 60000);
    el.textContent = `เชื่อมต่อ Google Drive อยู่ (จะหมดอายุใน ~${mins} นาที ต้องกดเชื่อมต่อใหม่หลังจากนั้น)`;
    el.style.color = 'var(--color-green)';
  } else {
    el.textContent = 'ยังไม่ได้เชื่อมต่อ Google Drive ในรอบการใช้งานนี้';
    el.style.color = '';
  }
}

async function onSaveDriveSettings(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const newSettings = {
    ...state.settings,
    driveEnabled: fd.get('driveEnabled') === 'on',
    driveClientId: (fd.get('driveClientId') || '').trim(),
    driveFolderId: (fd.get('driveFolderId') || '').trim(),
  };
  await db.saveSettings(newSettings);
  await reloadFromDB();
  showToast('บันทึกการตั้งค่า Google Drive แล้ว');
}

async function onDriveConnect() {
  const clientId = (document.querySelector('#drive-settings-form [name="driveClientId"]').value || '').trim();
  if (!clientId) {
    showToast('กรุณากรอก Google OAuth Client ID ก่อน');
    return;
  }
  try {
    await drive.connect(clientId);
    showToast('เชื่อมต่อ Google Drive สำเร็จ');
  } catch (err) {
    showToast('เชื่อมต่อไม่สำเร็จ: ' + err.message);
  }
  updateDriveStatusUI();
}

async function onSaveSettings(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const monthlyAmount = parseFloat(fd.get('monthlyAmount'));
  const totalInstallments = parseInt(fd.get('totalInstallments'), 10);
  const firstDueDate = fd.get('firstDueDate');
  const dueDay = parseInt(fd.get('dueDay'), 10);

  let hasError = false;
  toggleFieldError(e.target, 'monthlyAmount', !(monthlyAmount > 0));
  toggleFieldError(e.target, 'totalInstallments', !(totalInstallments >= 1 && totalInstallments <= 999));
  if (!(monthlyAmount > 0) || !(totalInstallments >= 1 && totalInstallments <= 999) || !firstDueDate || !(dueDay >= 1 && dueDay <= 31)) {
    hasError = true;
  }
  if (hasError) return;

  const oldTotal = state.settings.totalInstallments;
  if (totalInstallments < oldTotal) {
    const willLose = state.installments.some((i) => i.installmentNumber > totalInstallments && (i.paidAmount != null || (i.slips && i.slips.length)));
    const msg = willLose
      ? `คุณกำลังลดจำนวนงวดจาก ${oldTotal} เหลือ ${totalInstallments} งวด — งวดที่ ${totalInstallments + 1} ถึง ${oldTotal} มีข้อมูลการชำระ/สลิปอยู่ และจะถูกลบถาวร ยืนยันหรือไม่?`
      : `คุณกำลังลดจำนวนงวดจาก ${oldTotal} เหลือ ${totalInstallments} งวด ยืนยันหรือไม่?`;
    if (!confirm(msg)) return;
  }

  const newSettings = {
    monthlyAmount,
    totalInstallments,
    firstDueDate,
    dueDay,
    principalFromFinance: fd.get('principalFromFinance') !== '' ? parseFloat(fd.get('principalFromFinance')) : null,
    overpaymentPolicyDefault: fd.get('overpaymentPolicyDefault'),
    notifyEnabled: fd.get('notifyEnabled') === 'on',
    notifyDaysBefore: parseInt(fd.get('notifyDaysBefore'), 10) || 0,
  };

  const existingByNumber = {};
  for (const inst of state.installments) existingByNumber[inst.installmentNumber] = inst;
  const newSchedule = calc.generateSchedule(newSettings, existingByNumber);

  await db.saveSettings(newSettings);
  await db.bulkPutInstallments(newSchedule);
  if (totalInstallments < oldTotal) await db.deleteInstallmentsAbove(totalInstallments);

  await reloadFromDB();
  showToast('บันทึกการตั้งค่าเรียบร้อย');
  render();
}

function toggleFieldError(form, name, isError) {
  const input = form.querySelector(`[name="${name}"]`);
  const field = input.closest('.field');
  field.classList.toggle('has-error', isError);
}

// ---------- Export / Backup / Restore / Reset ----------

function exportCSV() {
  const header = ['งวด', 'วันครบกำหนด', 'ค่างวด', 'จ่ายจริง', 'ส่วนต่าง', 'สถานะ', 'หมายเหตุ'];
  const rows = state.installments.map((inst) => {
    const status = calc.STATUS_LABEL[calc.computeStatus(inst)];
    const diff = calc.computeDiff(inst);
    return [
      inst.installmentNumber,
      inst.dueDate,
      inst.scheduledAmount,
      inst.paidAmount != null ? inst.paidAmount : '',
      diff != null ? diff : '',
      status,
      (inst.note || '').replace(/"/g, '""'),
    ];
  });
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `cx3-installments-${calc.todayISO()}.csv`);
  showToast('Export CSV สำเร็จ');
}

async function exportJSON() {
  const data = await db.exportAllData();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  downloadBlob(blob, `cx3-backup-${calc.todayISO()}.json`);
  showToast('สำรองข้อมูลสำเร็จ');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function onImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('การกู้คืนข้อมูลจะเขียนทับข้อมูลปัจจุบันทั้งหมด ยืนยันหรือไม่?')) { e.target.value = ''; return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await db.importAllData(data);
    await reloadFromDB();
    showToast('กู้คืนข้อมูลสำเร็จ');
    render();
  } catch (err) {
    showToast('ไฟล์ไม่ถูกต้อง: ' + err.message);
  }
  e.target.value = '';
}

function confirmResetStep1() {
  openModal(`
    <div class="modal-header"><h3>ยืนยันการรีเซ็ต (1/2)</h3><button class="modal-close" data-action="close-modal">✕</button></div>
    <p>คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลทั้งหมด (ตารางผ่อน สลิป และการตั้งค่า)? การกระทำนี้ไม่สามารถย้อนกลับได้</p>
    <div class="btn-block-row mt-16">
      <button class="btn btn-outline" data-action="close-modal">ยกเลิก</button>
      <button class="btn btn-danger" id="btn-reset-step2">ดำเนินการต่อ</button>
    </div>
  `, { center: true });
  document.getElementById('btn-reset-step2').addEventListener('click', confirmResetStep2);
}

function confirmResetStep2() {
  openModal(`
    <div class="modal-header"><h3>ยืนยันการรีเซ็ต (2/2)</h3><button class="modal-close" data-action="close-modal">✕</button></div>
    <p>พิมพ์คำว่า <b>ลบทั้งหมด</b> เพื่อยืนยันการลบข้อมูลถาวร</p>
    <div class="field"><input type="text" id="reset-confirm-text" placeholder="ลบทั้งหมด"></div>
    <div class="btn-block-row">
      <button class="btn btn-outline" data-action="close-modal">ยกเลิก</button>
      <button class="btn btn-danger" id="btn-reset-final" disabled>ลบข้อมูลทั้งหมด</button>
    </div>
  `, { center: true });
  const input = document.getElementById('reset-confirm-text');
  const finalBtn = document.getElementById('btn-reset-final');
  input.addEventListener('input', () => { finalBtn.disabled = input.value.trim() !== 'ลบทั้งหมด'; });
  finalBtn.addEventListener('click', async () => {
    await db.clearAll();
    const settings = buildDefaultSettings();
    await db.saveSettings(settings);
    const installments = calc.generateSchedule(settings);
    await db.bulkPutInstallments(installments);
    await reloadFromDB();
    closeModal();
    showToast('ลบข้อมูลทั้งหมดและตั้งค่าเริ่มต้นใหม่แล้ว');
    navigateTo('dashboard');
  });
}

// ---------- Notification reminder ----------

function checkDueReminder() {
  if (!state.settings.notifyEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const totals = calc.computeTotals(state.installments, state.settings);
  if (!totals.nextInstallment) return;
  if (totals.daysUntilNextDue == null || totals.daysUntilNextDue > state.settings.notifyDaysBefore || totals.daysUntilNextDue < 0) return;
  const key = `cx3-notified-${totals.nextInstallment.installmentNumber}-${calc.todayISO()}`;
  if (localStorage.getItem(key)) return;
  new Notification('CX-3 แจ้งเตือนค่างวด', {
    body: `งวดที่ ${totals.nextInstallment.installmentNumber} จำนวน ${calc.fmtMoney(totals.nextInstallment.scheduledAmount)} บาท ครบกำหนด ${calc.fmtDate(totals.nextInstallment.dueDate)}`,
    icon: 'icons/icon-192.png',
  });
  localStorage.setItem(key, '1');
}

// ---------- Event delegation ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'open-installment') renderInstallmentModal(parseInt(el.dataset.n, 10));
  else if (action === 'close-modal') closeModal();
  else if (action === 'view-slip') viewSlip(parseInt(el.dataset.n, 10), parseInt(el.dataset.idx, 10));
  else if (action === 'remove-slip') { e.stopPropagation(); removeSlip(parseInt(el.dataset.n, 10), parseInt(el.dataset.idx, 10)); }
});

$nav.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn) navigateTo(btn.dataset.view);
});

// ---------- Init ----------

async function init() {
  await ensureInitialized();
  navigateTo('dashboard');
  checkDueReminder();

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('service-worker.js'); }
    catch (err) { console.warn('SW registration failed', err); }
  }
}

init();
