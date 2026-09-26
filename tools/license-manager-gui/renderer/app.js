// tools/license-manager-gui/renderer/app.js
// Studix License Manager — renderer UI logic (Phase 3). Plain DOM/vanilla JS, no framework —
// this window only ever talks to the main process through window.studixLicenseManager
// (exposed by preload.cjs via contextBridge). It never has Node/fs/crypto access itself, and
// it never receives a private key PEM from any IPC call — only safe metadata
// (fingerprint/public key/success flags).
'use strict';

const api = window.studixLicenseManager;

const el = (id) => document.getElementById(id);

let settings = { lastKeyStorePath: null, lastArtifactSaveDir: null, clipboardAutoClearSeconds: 30 };
let parsedRequest = null; // { v, installationId, product, machineId }
let lastIssueResult = null; // { artifact, licenseId, issuedAt, expiresAt, ... }
let featureTags = [];
let pendingAction = null; // 'unlock' | 'import' | 'generate'
let pendingChosenPath = null;

function showStatus(message, type) {
  const bar = el('status-bar');
  bar.classList.remove('hidden', 'success', 'error');
  bar.classList.add(type === 'error' ? 'error' : 'success');
  el('status-message').textContent = message;
  if (type !== 'error') {
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(() => bar.classList.add('hidden'), 4000);
  }
}

function hideStatus() {
  el('status-bar').classList.add('hidden');
}

// ── Key section ──────────────────────────────────────────────────────────────────────────
function setUnlockedView(info) {
  el('key-locked-view').classList.add('hidden');
  el('key-unlocked-view').classList.remove('hidden');
  const badge = el('key-status-badge');
  badge.textContent = 'مفتوح';
  badge.classList.add('unlocked');
  el('key-fingerprint').textContent = info.keyFingerprint ? info.keyFingerprint.slice(0, 16) + '…' : '—';
  el('key-source').textContent = { key_store: 'خزنة مفاتيح محمية', external_import: 'ملف مفتاح خارجي', new_keypair: 'زوج مفاتيح جديد' }[info.source] || '—';
  updateIssueButtonState();
}

function setLockedView() {
  el('key-locked-view').classList.remove('hidden');
  el('key-unlocked-view').classList.add('hidden');
  const badge = el('key-status-badge');
  badge.textContent = 'مغلق';
  badge.classList.remove('unlocked');
  hidePassphrasePanel();
  updateIssueButtonState();
}

function showPassphrasePanel({ label, showConfirm, peekInfo }) {
  el('passphrase-panel').classList.remove('hidden');
  el('passphrase-panel-label').textContent = label;
  el('passphrase-input').value = '';
  el('passphrase-confirm-input').value = '';
  el('new-keystore-extra').classList.toggle('hidden', !showConfirm);
  const peek = el('peek-info');
  if (peekInfo) {
    peek.textContent = peekInfo;
    peek.classList.remove('hidden');
  } else {
    peek.classList.add('hidden');
  }
  el('passphrase-input').focus();
}

function hidePassphrasePanel() {
  el('passphrase-panel').classList.add('hidden');
  pendingAction = null;
  pendingChosenPath = null;
  overwriteArmed = false;
}

el('btn-open-keystore').addEventListener('click', async () => {
  hideStatus();
  const filePath = await api.chooseOpenKeyStoreFile();
  if (!filePath) return;
  pendingAction = 'unlock';
  pendingChosenPath = filePath;
  const peek = await api.peekKeyStore(filePath);
  showPassphrasePanel({
    label: 'كلمة مرور خزنة المفاتيح',
    showConfirm: false,
    peekInfo: peek.ok ? `البصمة: ${peek.keyFingerprint.slice(0, 24)}…` : null,
  });
});

el('btn-import-external').addEventListener('click', async () => {
  hideStatus();
  const filePath = await api.chooseOpenExternalKeyFile();
  if (!filePath) return;
  pendingAction = 'import';
  pendingChosenPath = filePath;
  showPassphrasePanel({ label: 'كلمة مرور الملف (اتركها فارغة إن لم يكن الملف مشفّراً)', showConfirm: false, peekInfo: null });
});

el('btn-generate-new').addEventListener('click', async () => {
  hideStatus();
  const filePath = await api.chooseSaveKeyStoreFile();
  if (!filePath) return;
  pendingAction = 'generate';
  pendingChosenPath = filePath;
  showPassphrasePanel({
    label: 'اختر كلمة مرور لحماية زوج المفاتيح الجديد',
    showConfirm: true,
    peekInfo: '⚠ سيتم إنشاء زوج مفاتيح Ed25519 جديد بالكامل. لا تفعل هذا إلا إذا كنت تُصدر نظام الترخيص لأول مرة، أو تتعمّد استبدال المفتاح الحالي.',
  });
});

el('btn-cancel-passphrase').addEventListener('click', hidePassphrasePanel);

// overwriteArmed: set only after the operator has already seen the "file already exists"
// rejection once and pressed "تأكيد" again — this is the one explicit second action required
// before any existing key store file is overwritten (never automatic, never a single click).
let overwriteArmed = false;

async function confirmPassphrase() {
  const passphrase = el('passphrase-input').value;
  const confirmVal = el('passphrase-confirm-input').value;
  if (!pendingAction || !pendingChosenPath) return;

  if (pendingAction === 'unlock') {
    const result = await api.unlockKeyStore({ filePath: pendingChosenPath, passphrase });
    if (!result.ok) return showStatus(result.error.message, 'error');
    settings.lastKeyStorePath = pendingChosenPath;
    api.saveSettings(settings);
    hidePassphrasePanel();
    setUnlockedView(result);
    showStatus('تم فتح المفتاح بنجاح.', 'success');
    return;
  }

  if (pendingAction === 'import') {
    const result = await api.importExternalKey({ filePath: pendingChosenPath, passphrase: passphrase || undefined });
    if (!result.ok) return showStatus(result.error.message, 'error');
    hidePassphrasePanel();
    setUnlockedView(result);
    showStatus('تم استيراد المفتاح بنجاح لهذه الجلسة فقط.', 'success');
    return;
  }

  if (pendingAction === 'generate' || pendingAction === 'protect') {
    if (passphrase.length < 8) return showStatus('يجب أن تتكوّن كلمة المرور من ٨ أحرف على الأقل.', 'error');
    if (passphrase !== confirmVal) return showStatus('كلمتا المرور غير متطابقتين.', 'error');

    const result = pendingAction === 'generate'
      ? await api.createKeyStoreFromNewKeypair({ filePath: pendingChosenPath, passphrase, overwrite: overwriteArmed })
      : await api.createKeyStoreFromSessionKey({ filePath: pendingChosenPath, passphrase, overwrite: overwriteArmed });

    if (!result.ok && /already exists/i.test(result.error.message) && !overwriteArmed) {
      overwriteArmed = true;
      return showStatus(`${result.error.message} — اضغط "تأكيد" مجدداً لاستبداله عمداً.`, 'error');
    }
    if (!result.ok) return showStatus(result.error.message, 'error');

    settings.lastKeyStorePath = pendingChosenPath;
    api.saveSettings(settings);
    overwriteArmed = false;
    hidePassphrasePanel();
    if (pendingAction === 'generate') setUnlockedView(result);
    showStatus(pendingAction === 'generate' ? 'تم إنشاء زوج مفاتيح جديد وحمايته بنجاح.' : 'تم حفظ المفتاح في خزنة محمية بنجاح.', 'success');
  }
}

el('btn-confirm-passphrase').addEventListener('click', confirmPassphrase);

el('btn-protect-session-key').addEventListener('click', async () => {
  hideStatus();
  const filePath = await api.chooseSaveKeyStoreFile();
  if (!filePath) return;
  pendingAction = 'protect';
  pendingChosenPath = filePath;
  overwriteArmed = false;
  showPassphrasePanel({ label: 'اختر كلمة مرور لحفظ هذا المفتاح في خزنة محمية', showConfirm: true, peekInfo: null });
});

el('btn-lock-key').addEventListener('click', async () => {
  await api.clearSession();
  setLockedView();
  showStatus('تم قفل المفتاح.', 'success');
});

// ── Request code section ────────────────────────────────────────────────────────────────
el('btn-parse-code').addEventListener('click', async () => {
  hideStatus();
  const code = el('request-code-input').value.trim();
  if (!code) return showStatus('الصق رمز طلب التفعيل أولاً.', 'error');
  const result = await api.parseRequestCode(code);
  if (!result.ok) {
    el('request-info').classList.add('hidden');
    parsedRequest = null;
    updateIssueButtonState();
    return showStatus(result.error.message, 'error');
  }
  parsedRequest = result.data;
  el('req-installation').textContent = parsedRequest.installationId;
  el('req-machine').textContent = parsedRequest.machineId;
  el('req-product').textContent = parsedRequest.product;
  el('request-info').classList.remove('hidden');
  updateIssueButtonState();
  showStatus('تم تحليل رمز الطلب بنجاح.', 'success');
});

// ── License terms section ───────────────────────────────────────────────────────────────
el('perpetual-checkbox').addEventListener('change', (e) => {
  el('expiry-field').classList.toggle('hidden', e.target.checked);
});
el('expiry-field').classList.toggle('hidden', el('perpetual-checkbox').checked);

function renderFeatureTags() {
  const container = el('features-tags');
  container.innerHTML = '';
  for (const tag of featureTags) {
    const span = document.createElement('span');
    span.className = 'tag';
    const text = document.createElement('span');
    text.textContent = tag;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      featureTags = featureTags.filter((t) => t !== tag);
      renderFeatureTags();
    });
    span.append(text, removeBtn);
    container.appendChild(span);
  }
}
el('feature-entry-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const value = e.target.value.trim();
  if (value && !featureTags.includes(value)) {
    featureTags.push(value);
    renderFeatureTags();
  }
  e.target.value = '';
});

function updateIssueButtonState() {
  el('btn-issue').disabled = !(parsedRequest && el('key-status-badge').classList.contains('unlocked'));
}

el('btn-issue').addEventListener('click', async () => {
  hideStatus();
  if (!parsedRequest) return showStatus('حلّل رمز طلب التفعيل أولاً.', 'error');

  const perpetual = el('perpetual-checkbox').checked;
  let expiresAt = null;
  if (!perpetual) {
    const dateVal = el('expiry-date-input').value;
    if (!dateVal) return showStatus('اختر تاريخ الانتهاء، أو فعّل الترخيص الدائم.', 'error');
    expiresAt = new Date(`${dateVal}T23:59:59`).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return showStatus('تاريخ الانتهاء يجب أن يكون في المستقبل.', 'error');
  }

  const licenseId = el('license-id-input').value.trim() || undefined;
  const notes = el('notes-input').value.trim() || null;

  const result = await api.issueLicense({
    licenseId,
    installationId: parsedRequest.installationId,
    product: parsedRequest.product,
    machineId: parsedRequest.machineId,
    expiresAt,
    features: featureTags.length ? featureTags.slice() : null,
    notes,
  });

  if (!result.ok) return showStatus(result.error.message, 'error');

  lastIssueResult = result.data;
  el('artifact-output').value = lastIssueResult.artifact;
  el('res-license-id').textContent = lastIssueResult.licenseId;
  el('res-issued-at').textContent = new Date(lastIssueResult.issuedAt).toLocaleString('ar-EG');
  el('res-expires-at').textContent = lastIssueResult.expiresAt === null ? 'دائم' : new Date(lastIssueResult.expiresAt).toLocaleString('ar-EG');
  el('card-result').classList.remove('hidden');
  el('card-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showStatus('تم إصدار شهادة الترخيص بنجاح.', 'success');
});

// ── Result section ───────────────────────────────────────────────────────────────────────
el('btn-copy-artifact').addEventListener('click', async () => {
  if (!lastIssueResult) return;
  await api.copyToClipboard(lastIssueResult.artifact);
  showStatus('تم نسخ شهادة الترخيص إلى الحافظة.', 'success');
  if (el('clipboard-autoclear-checkbox').checked) {
    const seconds = settings.clipboardAutoClearSeconds || 30;
    setTimeout(() => api.clearClipboardIfMatches(lastIssueResult.artifact), seconds * 1000);
  }
});

el('btn-save-artifact').addEventListener('click', async () => {
  if (!lastIssueResult) return;
  const defaultName = `${lastIssueResult.licenseId}.lic`;
  const filePath = await api.chooseSaveArtifactFile(defaultName);
  if (!filePath) return;
  const result = await api.saveArtifactToFile({ filePath, artifact: lastIssueResult.artifact });
  if (!result.ok) return showStatus(result.error.message, 'error');
  showStatus(`تم حفظ الشهادة في: ${filePath}`, 'success');
});

// ── Session clear ────────────────────────────────────────────────────────────────────────
el('btn-clear-session').addEventListener('click', async () => {
  await api.clearSession();
  setLockedView();
  parsedRequest = null;
  lastIssueResult = null;
  featureTags = [];
  el('request-code-input').value = '';
  el('request-info').classList.add('hidden');
  el('license-id-input').value = '';
  el('notes-input').value = '';
  el('perpetual-checkbox').checked = true;
  el('expiry-date-input').value = '';
  el('expiry-field').classList.add('hidden');
  renderFeatureTags();
  el('artifact-output').value = '';
  el('card-result').classList.add('hidden');
  updateIssueButtonState();
  showStatus('تم مسح كل بيانات الجلسة الحسّاسة.', 'success');
});

// ── Startup ──────────────────────────────────────────────────────────────────────────────
(async function init() {
  const info = await api.appInfo();
  el('app-version').textContent = `${info.name} — v${info.version}`;

  settings = await api.loadSettings();
  el('autoclear-seconds').textContent = String(settings.clipboardAutoClearSeconds || 30);

  const session = await api.sessionInfo();
  if (session.unlocked) setUnlockedView(session);
  else setLockedView();
})();
