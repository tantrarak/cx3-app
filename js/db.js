// db.js — Supabase-backed persistence. Replaces the earlier IndexedDB version so data
// syncs across devices. Function names/shapes are kept close to the old IndexedDB API
// so the rest of the app didn't need to change much.
//
// Slip binaries live in Supabase Storage (bucket "slips", path `${userId}/${installmentNumber}/${slipId}.${ext}`).
// Each installment row keeps only slip *metadata* (id, storagePath, mimeType, fileName, uploadedAt, drive* fields)
// in a jsonb column — the actual image bytes are fetched on demand via signed URL or download().

import { supabase } from './supabaseClient.js';

const SLIP_BUCKET = 'slips';

export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('NOT_AUTHENTICATED');
  return data.user.id;
}

function mapSettingsFromRow(row) {
  return {
    monthlyAmount: Number(row.monthly_amount),
    totalInstallments: row.total_installments,
    firstDueDate: row.first_due_date,
    dueDay: row.due_day,
    principalFromFinance: row.principal_from_finance != null ? Number(row.principal_from_finance) : null,
    overpaymentPolicyDefault: row.overpayment_policy_default || 'accumulate',
    notifyEnabled: !!row.notify_enabled,
    notifyDaysBefore: row.notify_days_before ?? 3,
    driveEnabled: !!row.drive_enabled,
    driveClientId: row.drive_client_id || '',
    driveFolderId: row.drive_folder_id || '',
  };
}

function mapSettingsToRow(s, userId) {
  return {
    user_id: userId,
    monthly_amount: s.monthlyAmount,
    total_installments: s.totalInstallments,
    first_due_date: s.firstDueDate,
    due_day: s.dueDay,
    principal_from_finance: s.principalFromFinance,
    overpayment_policy_default: s.overpaymentPolicyDefault,
    notify_enabled: s.notifyEnabled,
    notify_days_before: s.notifyDaysBefore,
    drive_enabled: s.driveEnabled,
    drive_client_id: s.driveClientId,
    drive_folder_id: s.driveFolderId,
    updated_at: new Date().toISOString(),
  };
}

function mapInstallmentFromRow(row) {
  return {
    installmentNumber: row.installment_number,
    dueDate: row.due_date,
    scheduledAmount: Number(row.scheduled_amount),
    paidAmount: row.paid_amount != null ? Number(row.paid_amount) : null,
    paidDate: row.paid_date,
    paidTime: row.paid_time,
    overpaymentAllocation: row.overpayment_allocation,
    remainingPrincipal: row.remaining_principal != null ? Number(row.remaining_principal) : null,
    remainingInterest: row.remaining_interest != null ? Number(row.remaining_interest) : null,
    note: row.note || '',
    slips: row.slips || [],
  };
}

function mapInstallmentToRow(inst, userId) {
  return {
    user_id: userId,
    installment_number: inst.installmentNumber,
    due_date: inst.dueDate,
    scheduled_amount: inst.scheduledAmount,
    paid_amount: inst.paidAmount,
    paid_date: inst.paidDate,
    paid_time: inst.paidTime,
    overpayment_allocation: inst.overpaymentAllocation,
    remaining_principal: inst.remainingPrincipal,
    remaining_interest: inst.remainingInterest,
    note: inst.note || '',
    slips: inst.slips || [],
    updated_at: new Date().toISOString(),
  };
}

export async function getSettings() {
  const uid = await getCurrentUserId();
  const { data, error } = await supabase.from('settings').select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data ? mapSettingsFromRow(data) : null;
}

export async function saveSettings(settings) {
  const uid = await getCurrentUserId();
  const { error } = await supabase.from('settings').upsert(mapSettingsToRow(settings, uid));
  if (error) throw error;
}

export async function getAllInstallments() {
  const uid = await getCurrentUserId();
  const { data, error } = await supabase
    .from('installments')
    .select('*')
    .eq('user_id', uid)
    .order('installment_number');
  if (error) throw error;
  return (data || []).map(mapInstallmentFromRow);
}

export async function getInstallment(n) {
  const uid = await getCurrentUserId();
  const { data, error } = await supabase
    .from('installments')
    .select('*')
    .eq('user_id', uid)
    .eq('installment_number', n)
    .maybeSingle();
  if (error) throw error;
  return data ? mapInstallmentFromRow(data) : null;
}

export async function saveInstallment(installment) {
  const uid = await getCurrentUserId();
  const { error } = await supabase
    .from('installments')
    .upsert(mapInstallmentToRow(installment, uid), { onConflict: 'user_id,installment_number' });
  if (error) throw error;
}

export async function bulkPutInstallments(installments) {
  const uid = await getCurrentUserId();
  const rows = installments.map((i) => mapInstallmentToRow(i, uid));
  const { error } = await supabase
    .from('installments')
    .upsert(rows, { onConflict: 'user_id,installment_number' });
  if (error) throw error;
}

export async function deleteInstallmentsAbove(n) {
  const uid = await getCurrentUserId();
  const { error } = await supabase
    .from('installments')
    .delete()
    .eq('user_id', uid)
    .gt('installment_number', n);
  if (error) throw error;
}

export async function clearAll() {
  const uid = await getCurrentUserId();
  try {
    const installments = await getAllInstallments();
    const paths = installments.flatMap((inst) => (inst.slips || []).map((s) => s.storagePath).filter(Boolean));
    if (paths.length) await supabase.storage.from(SLIP_BUCKET).remove(paths);
  } catch (err) {
    console.warn('Could not clean up slip files before reset', err);
  }
  await supabase.from('installments').delete().eq('user_id', uid);
  await supabase.from('settings').delete().eq('user_id', uid);
}

// ---------- Slip file storage ----------

export function slipStoragePath(userId, installmentNumber, slipId, ext) {
  return `${userId}/${installmentNumber}/${slipId}.${ext}`;
}

export async function uploadSlipFile(storagePath, file) {
  const { error } = await supabase.storage.from(SLIP_BUCKET).upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
}

export async function getSlipSignedUrl(storagePath, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(SLIP_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadSlipFile(storagePath) {
  const { data, error } = await supabase.storage.from(SLIP_BUCKET).download(storagePath);
  if (error) throw error;
  return data; // Blob
}

export async function deleteSlipFile(storagePath) {
  const { error } = await supabase.storage.from(SLIP_BUCKET).remove([storagePath]);
  if (error) throw error;
}

// ---------- Backup / restore (JSON, slip images embedded as data URLs) ----------

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataURL) {
  const res = await fetch(dataURL);
  return res.blob();
}

export async function exportAllData() {
  const settings = await getSettings();
  const installments = await getAllInstallments();
  const installmentsForExport = [];
  for (const inst of installments) {
    const slips = [];
    for (const slip of inst.slips || []) {
      let dataURL = null;
      try {
        const blob = await downloadSlipFile(slip.storagePath);
        dataURL = await blobToDataURL(blob);
      } catch (err) {
        console.warn('Could not download slip for export', slip.storagePath, err);
      }
      slips.push({ id: slip.id, mimeType: slip.mimeType, fileName: slip.fileName, uploadedAt: slip.uploadedAt, dataURL });
    }
    installmentsForExport.push({ ...inst, slips });
  }
  return {
    exportedAt: new Date().toISOString(),
    appVersion: 2,
    settings,
    installments: installmentsForExport,
  };
}

// Imports a backup JSON (from either the old IndexedDB export or Supabase export format)
// into Supabase for the currently signed-in user. Re-uploads embedded slip images to Storage.
export async function importAllData(data, { onProgress } = {}) {
  if (!data || !data.settings || !Array.isArray(data.installments)) {
    throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
  }
  const uid = await getCurrentUserId();
  await saveSettings(data.settings);

  const installments = [];
  let done = 0;
  for (const inst of data.installments) {
    const slips = [];
    for (const slip of inst.slips || []) {
      if (!slip.dataURL) continue;
      try {
        const blob = await dataURLToBlob(slip.dataURL);
        const ext = (slip.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
        const storagePath = slipStoragePath(uid, inst.installmentNumber, slip.id, ext);
        await uploadSlipFile(storagePath, blob);
        slips.push({
          id: slip.id,
          storagePath,
          mimeType: slip.mimeType,
          fileName: slip.fileName,
          uploadedAt: slip.uploadedAt,
          driveStatus: slip.driveStatus || null,
          driveFileId: slip.driveFileId,
          driveWebViewLink: slip.driveWebViewLink,
        });
      } catch (err) {
        console.warn('Could not import slip', slip.id, err);
      }
    }
    installments.push({ ...inst, slips });
    done++;
    if (onProgress) onProgress(done, data.installments.length);
  }
  await bulkPutInstallments(installments);
}
