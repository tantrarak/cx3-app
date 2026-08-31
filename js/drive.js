// drive.js — optional, best-effort Google Drive auto-backup for slip photos.
// Pure client-side (no backend): uses Google Identity Services implicit token flow,
// so the access token only lives in memory for this page session (~1hr, then needs reconnect).
// Failures here must never block the local IndexedDB save — Drive is a backup layer only.

let tokenClient = null;
let tokenClientId = null;
let accessToken = null;
let tokenExpiresAt = 0;

function ensureTokenClient(clientId) {
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    throw new Error('Google Identity Services ยังโหลดไม่สำเร็จ ลองรีเฟรชหน้าแล้วลองใหม่');
  }
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: () => {},
    });
    tokenClientId = clientId;
    accessToken = null;
    tokenExpiresAt = 0;
  }
  return tokenClient;
}

export function isConnected() {
  return !!accessToken && Date.now() < tokenExpiresAt - 30000;
}

export function msUntilExpiry() {
  return Math.max(0, tokenExpiresAt - Date.now());
}

export function connect(clientId) {
  return new Promise((resolve, reject) => {
    let client;
    try {
      client = ensureTokenClient(clientId);
    } catch (err) {
      reject(err);
      return;
    }
    client.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (resp.expires_in * 1000);
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: 'consent' });
  });
}

export function disconnect() {
  if (accessToken && window.google) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
}

async function requireToken(clientId) {
  if (isConnected()) return accessToken;
  throw new Error('NOT_CONNECTED');
}

export async function uploadFileToFolder({ clientId, folderId, file, fileName }) {
  const token = await requireToken(clientId);
  const metadata = { name: fileName, parents: [folderId] };
  const boundary = 'cx3-boundary-' + Date.now();
  const encoder = new TextEncoder();
  const metaBytes = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const mediaHeaderBytes = encoder.encode(`--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`);
  const closeBytes = encoder.encode(`\r\n--${boundary}--`);
  const fileBuffer = await file.arrayBuffer();
  const body = new Blob([metaBytes, mediaHeaderBytes, fileBuffer, closeBytes]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive upload failed: ${res.status} ${text}`);
  }
  return res.json();
}
