/**
 * gas-sat-additions.js
 *
 * SAT-tier auth for "TCK Reps for SAT (Demo)". This is a SEPARATE
 * user pool from the TOEFL demo: it reads/writes a dedicated
 * USERS_SAT sheet and is reached through new actions
 * (signupSat / loginSat / recoverSatPass). A TOEFL-demo account
 * (USERS_TRIAL) or a paid-course account (USERS) does NOT work here,
 * and vice versa — exactly the separation requested.
 *
 * The deployment URL is unchanged (one Apps Script project, routed by
 * the `action` param), so the front end keeps the same API_URL.
 *
 * Sheet layout (USERS_SAT — A:G), same shape as USERS_TRIAL:
 *   A: id            (auto: sat-{timestamp})
 *   B: pass          (plain — demo tier; see HASHING note below)
 *   C: name
 *   D: email
 *   E: created_at
 *   F: last_login_at
 *   G: pass_temp_at  (timestamp when a recovery password was issued)
 *
 * INSTALLATION
 * ============
 * 1. Open the same TCK Reps GAS project that already hosts the TOEFL
 *    demo handlers.
 * 2. Add three lines to the doGet() routing block (next to the
 *    existing signupTrial / loginTrial / recoverTrialPass lines):
 *      if (action === 'signupSat')      return handleSignupSat_(e, callback);
 *      if (action === 'loginSat')       return handleLoginSat_(e, callback);
 *      if (action === 'recoverSatPass') return handleRecoverSatPass_(e, callback);
 * 3. Paste the three functions below anywhere in the project.
 * 4. (Optional) Create a tab named USERS_SAT now, or let
 *    handleSignupSat_ create it on first signup.
 * 5. Save → Deploy → Manage deployments → Edit current → New version.
 *    The API URL stays the same.
 *
 * Depends on helpers that already exist in the project (used by the
 * TOEFL trial handlers): jsonpResponse_, generateTempPassword_,
 * escapeHtml_, DATETIME_FMT, and the SAT_TEMP_PASS_TTL_MS constant
 * defined just below.
 *
 * HASHING (recommended before any real launch)
 * =============================================
 * These handlers store the password in plain text to match the proven
 * TOEFL trial pattern and guarantee paste-and-go behavior. To harden,
 * replace every `=== String(pass)` comparison and every stored `pass`
 * with a salted SHA-256 digest:
 *   function hashPass_(salt, pass){
 *     var raw = Utilities.computeDigest(
 *       Utilities.DigestAlgorithm.SHA_256, salt + '|' + pass, Utilities.Charset.UTF_8);
 *     return raw.map(function(b){ return ('0'+(b&0xff).toString(16)).slice(-2); }).join('');
 *   }
 * Store salt in a new column H and compare hashPass_(salt, input) to col B.
 * Apply the same change to recover (store the hash of the temp password).
 */

var SAT_TEMP_PASS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function handleSignupSat_(e, callback) {
  var pass  = e.parameter.pass  || '';
  var name  = e.parameter.name  || '';
  var email = (e.parameter.email || '').trim();

  if (!pass || !name || !email) {
    return jsonpResponse_(callback, { success: false, error: 'missing_params' });
  }
  if (String(pass).length < 4) {
    return jsonpResponse_(callback, { success: false, error: 'pass_too_short' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonpResponse_(callback, { success: false, error: 'invalid_email' });
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('USERS_SAT');
  if (!sh) {
    sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet('USERS_SAT');
    sh.appendRow(['id','pass','name','email','created_at','last_login_at','pass_temp_at']);
  }
  var d = sh.getDataRange().getValues();
  var emailNorm = email.toLowerCase();

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][3] || '').trim().toLowerCase() === emailNorm) {
      return jsonpResponse_(callback, { success: false, error: 'duplicate_email' });
    }
  }

  // SAT IDs are prefixed `sat-` so they never collide with the TOEFL
  // trial pool (`trial-`) or the paid pool.
  var newId = 'sat-' + (new Date().getTime()).toString(36);
  var now = new Date();
  sh.appendRow([newId, pass, name, email, now, now, '']);
  sh.getRange(sh.getLastRow(), 5, 1, 2).setNumberFormat(DATETIME_FMT);

  return jsonpResponse_(callback, {
    success: true,
    userId: newId,
    userName: name,
    email: email
  });
}

function handleLoginSat_(e, callback) {
  var id   = e.parameter.id   || '';
  var pass = e.parameter.pass || '';
  if (!id || !pass) {
    return jsonpResponse_(callback, { success: false, error: 'missing_params' });
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('USERS_SAT');
  if (!sh) return jsonpResponse_(callback, { success: false, error: 'no_sheet' });
  var d = sh.getDataRange().getValues();

  for (var i = 1; i < d.length; i++) {
    var rowId = String(d[i][0] || '');
    var rowEmail = String(d[i][3] || '').trim().toLowerCase();
    var matches = rowId === String(id) || rowEmail === String(id).trim().toLowerCase();
    if (!matches) continue;
    if (String(d[i][1]) !== String(pass)) {
      return jsonpResponse_(callback, { success: false, error: 'invalid_credentials' });
    }
    var tempAt = d[i][6];
    var mustChange = false;
    if (tempAt) {
      if (new Date().getTime() - new Date(tempAt).getTime() > SAT_TEMP_PASS_TTL_MS) {
        return jsonpResponse_(callback, { success: false, error: 'temp_password_expired' });
      }
      mustChange = true;
    }
    var now = new Date();
    sh.getRange(i + 1, 6).setValue(now).setNumberFormat(DATETIME_FMT);
    return jsonpResponse_(callback, {
      success: true,
      userId: rowId,
      userName: String(d[i][2] || ''),
      email: String(d[i][3] || ''),
      mustChangePassword: mustChange
    });
  }
  return jsonpResponse_(callback, { success: false, error: 'invalid_credentials' });
}

function handleRecoverSatPass_(e, callback) {
  var email = (e.parameter.email || '').trim();
  if (!email) return jsonpResponse_(callback, { success: false, error: 'no_email' });

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('USERS_SAT');
  if (!sh) return jsonpResponse_(callback, { success: false, error: 'no_sheet' });
  var d = sh.getDataRange().getValues();
  var emailNorm = email.toLowerCase();

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][3] || '').trim().toLowerCase() !== emailNorm) continue;
    var userId = String(d[i][0]);
    var userName = String(d[i][2] || '');
    var tempPass = generateTempPassword_();
    var now = new Date();

    sh.getRange(i + 1, 2).setValue(tempPass);
    sh.getRange(i + 1, 7).setValue(now).setNumberFormat(DATETIME_FMT);

    var subject = 'TCK Reps for SAT (Demo) — 仮パスワードのお知らせ';
    var html =
      '<p>' + escapeHtml_(userName) + ' 様</p>' +
      '<p>TCK Reps for SAT（Demo）の仮パスワードを発行しました。</p>' +
      '<table style="border-collapse:collapse;margin:12px 0">' +
        '<tr><td style="padding:4px 12px 4px 0;color:#5A6861">User ID</td>' +
            '<td style="padding:4px 0;font-weight:700">' + escapeHtml_(userId) + '</td></tr>' +
        '<tr><td style="padding:4px 12px 4px 0;color:#5A6861">仮パスワード</td>' +
            '<td style="padding:4px 0;font-weight:700;font-family:monospace">' + tempPass + '</td></tr>' +
      '</table>' +
      '<p style="color:#8A6D2A">※ 24時間以内にログイン後、パスワードを変更してください。期限を過ぎると無効になります。</p>' +
      '<p style="color:#5A6861;font-size:.9em">このアカウントは SAT 演習専用です（TOEFL Reps Demo とは別のIDです）。</p>' +
      '<p style="margin-top:24px">— TCK Workshop · TCK Reps for SAT (Demo)</p>';

    try {
      MailApp.sendEmail({ to: email, subject: subject, htmlBody: html });
    } catch (mailErr) {
      return jsonpResponse_(callback, { success: false, error: 'mail_failed', detail: String(mailErr) });
    }
    return jsonpResponse_(callback, { success: true });
  }
  return jsonpResponse_(callback, { success: false, error: 'not_found' });
}
