/* ============================================================
   TCK Reps for SAT (Demo) — API client
   ============================================================
   Talks to the TCK Reps GAS backend, but only against the
   SAT-tier endpoints (signupSat / loginSat / recoverSatPass)
   which write/read a DEDICATED USERS_SAT sheet — a separate pool
   from the TOEFL demo's USERS_TRIAL. A TOEFL-demo or paid-course
   account does NOT grant access here.

   The deployment URL is shared (one Apps Script project, routed by
   the `action` param). Override per-deployment via
   SAT_CONFIG.apiUrlOverride without editing this file.
   ============================================================ */

var API_URL = (typeof SAT_CONFIG !== 'undefined' && SAT_CONFIG.apiUrlOverride)
  ? SAT_CONFIG.apiUrlOverride
  : 'https://script.google.com/macros/s/AKfycbwjI8n86Cu1ar1IsPffyq9mboDrUNpG-SsVpFtURjP6AmCFHD3Zbw5_qcJJUksz_UDyyw/exec';

function _jsonpRequest(url) {
  return new Promise(function(resolve, reject) {
    var cb = '__tckCb_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    var script = document.createElement('script');
    var done = false;
    var timeout = setTimeout(function() {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('timeout'));
    }, 30000);
    function cleanup() {
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      clearTimeout(timeout);
    }
    window[cb] = function(data) {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };
    script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + cb;
    script.onerror = function() {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('network'));
    };
    document.body.appendChild(script);
  });
}

var Api = {
  /* SAT signup — creates a row in the dedicated USERS_SAT sheet.
     Returns { success, userId, userName, email, error? }. */
  signup: function(id, pass, name, email) {
    return _jsonpRequest(API_URL + '?action=signupSat'
      + '&id=' + encodeURIComponent(id)
      + '&pass=' + encodeURIComponent(pass)
      + '&name=' + encodeURIComponent(name)
      + '&email=' + encodeURIComponent(email));
  },

  /* SAT login — verifies against USERS_SAT only.
     Returns { success, userId, userName, email, error? }. */
  login: function(id, pass) {
    return _jsonpRequest(API_URL + '?action=loginSat'
      + '&id=' + encodeURIComponent(id)
      + '&pass=' + encodeURIComponent(pass));
  },

  /* SAT password recovery — issues a fresh temp password against
     USERS_SAT and emails it (server enforces a 24h TTL).
     Returns { success, error? }. */
  recover: function(email) {
    return _jsonpRequest(API_URL + '?action=recoverSatPass'
      + '&email=' + encodeURIComponent(email));
  },

  /* Save a completed module attempt to the ANSWERS sheet. The user
     is read from the SAT session (Auth → tck_sat_user). `setName`
     is "SAT R&W · <test_id>". The SAT-prefixed set name keeps these
     rows distinguishable from TOEFL rows in the shared sheet. */
  saveAnswers: function(setName, answers, score, meta) {
    var user = {};
    try { if (typeof Auth !== 'undefined' && Auth.getUser) user = Auth.getUser() || {}; }
    catch(e) { user = {}; }
    meta = meta || {};
    var url = API_URL + '?action=saveAnswers'
      + '&userId='   + encodeURIComponent(user.userId   || '')
      + '&userName=' + encodeURIComponent(user.userName || '')
      + '&set='      + encodeURIComponent(setName)
      + '&answers='  + encodeURIComponent(JSON.stringify(answers))
      + '&score='    + encodeURIComponent(score)
      + '&harderCorrect=' + encodeURIComponent(meta.harderCorrect || 0)
      + '&harderTotal='   + encodeURIComponent(meta.harderTotal   || 0)
      + '&attemptNumber=' + encodeURIComponent(meta.attemptNumber || 1);
    return _jsonpRequest(url);
  }
};
