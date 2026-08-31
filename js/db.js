// db.js — IndexedDB wrapper. Structure is deliberately flat/plain-object so it can be
// swapped for Firebase/Supabase later: settings = single document, installments = collection
// keyed by installmentNumber, each installment optionally embeds slip images.

const DB_NAME = 'cx3-db';
const DB_VERSION = 1;
const STORE_SETTINGS = 'settings';
const STORE_INSTALLMENTS = 'installments';
const SETTINGS_ID = 'main';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_INSTALLMENTS)) {
        db.createObjectStore(STORE_INSTALLMENTS, { keyPath: 'installmentNumber' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getSettings() {
  const store = await tx(STORE_SETTINGS, 'readonly');
  const result = await reqToPromise(store.get(SETTINGS_ID));
  return result || null;
}

export async function saveSettings(settings) {
  const store = await tx(STORE_SETTINGS, 'readwrite');
  await reqToPromise(store.put({ ...settings, id: SETTINGS_ID }));
}

export async function getAllInstallments() {
  const store = await tx(STORE_INSTALLMENTS, 'readonly');
  const result = await reqToPromise(store.getAll());
  return (result || []).sort((a, b) => a.installmentNumber - b.installmentNumber);
}

export async function getInstallment(n) {
  const store = await tx(STORE_INSTALLMENTS, 'readonly');
  return reqToPromise(store.get(n));
}

export async function saveInstallment(installment) {
  const store = await tx(STORE_INSTALLMENTS, 'readwrite');
  await reqToPromise(store.put(installment));
}

export async function bulkPutInstallments(installments) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_INSTALLMENTS, 'readwrite');
    const store = t.objectStore(STORE_INSTALLMENTS);
    for (const inst of installments) store.put(inst);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deleteInstallmentsAbove(n) {
  const all = await getAllInstallments();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_INSTALLMENTS, 'readwrite');
    const store = t.objectStore(STORE_INSTALLMENTS);
    for (const inst of all) {
      if (inst.installmentNumber > n) store.delete(inst.installmentNumber);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_SETTINGS, STORE_INSTALLMENTS], 'readwrite');
    t.objectStore(STORE_SETTINGS).clear();
    t.objectStore(STORE_INSTALLMENTS).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

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
      slips.push({
        id: slip.id,
        mimeType: slip.mimeType,
        fileName: slip.fileName,
        uploadedAt: slip.uploadedAt,
        dataURL: slip.blob ? await blobToDataURL(slip.blob) : null,
      });
    }
    installmentsForExport.push({ ...inst, slips });
  }
  return {
    exportedAt: new Date().toISOString(),
    appVersion: 1,
    settings,
    installments: installmentsForExport,
  };
}

export async function importAllData(data) {
  if (!data || !data.settings || !Array.isArray(data.installments)) {
    throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
  }
  await clearAll();
  await saveSettings(data.settings);
  const installments = [];
  for (const inst of data.installments) {
    const slips = [];
    for (const slip of inst.slips || []) {
      slips.push({
        id: slip.id,
        mimeType: slip.mimeType,
        fileName: slip.fileName,
        uploadedAt: slip.uploadedAt,
        blob: slip.dataURL ? await dataURLToBlob(slip.dataURL) : null,
      });
    }
    installments.push({ ...inst, slips });
  }
  await bulkPutInstallments(installments);
}
