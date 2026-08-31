// calc.js — pure calculation functions, no DOM/IndexedDB dependency.

export function roundMoney(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function fmtMoney(n) {
  const v = roundMoney(n || 0);
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function todayISO() {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addMonthsKeepDay(isoDate, months, dueDay) {
  const base = new Date(isoDate + 'T00:00:00');
  const targetMonthIndex = base.getMonth() + months;
  const year = base.getFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(dueDay || base.getDate(), daysInMonth);
  return toISODate(new Date(year, month, day));
}

export function diffDays(fromISO, toISO) {
  const a = new Date(fromISO + 'T00:00:00');
  const b = new Date(toISO + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/**
 * สร้างตารางงวดใหม่ตามการตั้งค่า โดยพยายามรักษาข้อมูลงวดเดิมที่มีอยู่แล้ว (existingByNumber)
 */
export function generateSchedule(settings, existingByNumber = {}) {
  const { firstDueDate, dueDay, totalInstallments, monthlyAmount } = settings;
  const result = [];
  for (let n = 1; n <= totalInstallments; n++) {
    const dueDate = addMonthsKeepDay(firstDueDate, n - 1, dueDay);
    const existing = existingByNumber[n];
    if (existing) {
      result.push({ ...existing, dueDate, scheduledAmount: existing.scheduledAmount ?? monthlyAmount });
    } else {
      result.push({
        installmentNumber: n,
        dueDate,
        scheduledAmount: monthlyAmount,
        paidAmount: null,
        paidDate: null,
        paidTime: null,
        overpaymentAllocation: null,
        remainingPrincipal: null,
        remainingInterest: null,
        note: '',
        slips: [],
      });
    }
  }
  return result;
}

export function computeDiff(installment) {
  if (installment.paidAmount == null) return null;
  return roundMoney(installment.paidAmount - installment.scheduledAmount);
}

export function computeStatus(installment, today = todayISO()) {
  const diff = computeDiff(installment);
  if (diff == null) {
    return installment.dueDate < today ? 'late' : 'pending';
  }
  if (Math.abs(diff) < 0.005) return 'paid';
  if (diff > 0) return 'overpaid';
  return 'partial';
}

export const STATUS_LABEL = {
  paid: 'ชำระแล้ว',
  pending: 'รอชำระ',
  overpaid: 'ชำระเกิน',
  partial: 'ชำระบางส่วน',
  late: 'ล่าช้า',
};

export const STATUS_COLOR = {
  paid: 'var(--color-green)',
  pending: 'var(--color-gray)',
  overpaid: 'var(--color-orange)',
  partial: 'var(--color-orange)',
  late: 'var(--color-red)',
};

export function computeTotals(installments, settings, today = todayISO()) {
  const totalContract = roundMoney(settings.monthlyAmount * settings.totalInstallments);
  let paidCount = 0;
  let totalPaid = 0;
  let totalOverpaid = 0;
  const byAllocation = { accumulate: 0, principal: 0, advance: 0 };
  let latestRemainingPrincipal = null;
  let latestRemainingPrincipalNumber = -1;
  let dueToDate = 0;

  for (const inst of installments) {
    const status = computeStatus(inst, today);
    if (inst.dueDate <= today) dueToDate = roundMoney(dueToDate + inst.scheduledAmount);
    if (status !== 'pending' && status !== 'late') {
      paidCount++;
      totalPaid = roundMoney(totalPaid + (inst.paidAmount || 0));
      const diff = computeDiff(inst);
      if (diff && diff > 0) {
        totalOverpaid = roundMoney(totalOverpaid + diff);
        if (inst.overpaymentAllocation && byAllocation[inst.overpaymentAllocation] != null) {
          byAllocation[inst.overpaymentAllocation] = roundMoney(byAllocation[inst.overpaymentAllocation] + diff);
        }
      }
    }
    if (inst.remainingPrincipal != null && inst.installmentNumber > latestRemainingPrincipalNumber) {
      latestRemainingPrincipal = inst.remainingPrincipal;
      latestRemainingPrincipalNumber = inst.installmentNumber;
    }
  }

  const remainingCount = settings.totalInstallments - paidCount;
  const totalRemaining = roundMoney(totalContract - totalPaid);
  const progressPercent = settings.totalInstallments > 0
    ? roundMoney((paidCount / settings.totalInstallments) * 100)
    : 0;

  const nextInstallment = installments
    .filter((i) => computeStatus(i, today) === 'pending' || computeStatus(i, today) === 'late')
    .sort((a, b) => a.installmentNumber - b.installmentNumber)[0] || null;

  let daysUntilNextDue = null;
  if (nextInstallment) daysUntilNextDue = diffDays(today, nextInstallment.dueDate);

  return {
    totalContract,
    paidCount,
    remainingCount,
    totalPaid,
    totalRemaining,
    totalOverpaid,
    byAllocation,
    latestRemainingPrincipal,
    progressPercent,
    nextInstallment,
    daysUntilNextDue,
    dueToDate,
    shortfallToDate: roundMoney(dueToDate - totalPaid),
  };
}

export function planExtraPayment(monthlyAmount, amountThisMonth, remainingCount) {
  const extra = roundMoney(amountThisMonth - monthlyAmount);
  const totalIfEveryMonth = roundMoney(amountThisMonth * remainingCount);
  const extraAccumulated = roundMoney(extra * remainingCount);
  return { extra, totalIfEveryMonth, extraAccumulated };
}
