/* ============================================================
   TCK Reps Demo — API client
   ============================================================
   Talks to the shared TCK Reps GAS backend, but only against the
   trial-tier endpoints (signupTrial / loginTrial / recoverTrialPass)
   which write/read the USERS_TRIAL sheet. The full app's endpoints
   are not used here so the demo cannot accidentally pollute paid-tier
   data.
   ============================================================ */

var API_URL = 'https://script.google.com/macros/s/AKfycbwjI8n86Cu1ar1IsPffyq9mboDrUNpG-SsVpFtURjP6AmCFHD3Zbw5_qcJJUksz_UDyyw/exec';

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
  /* Demo signup — creates a row in the USERS_TRIAL sheet.
     Returns { success, userId, userName, email, error? }. */
  signup: function(id, pass, name, email) {
    return _jsonpRequest(API_URL + '?action=signupTrial'
      + '&id=' + encodeURIComponent(id)
      + '&pass=' + encodeURIComponent(pass)
      + '&name=' + encodeURIComponent(name)
      + '&email=' + encodeURIComponent(email));
  },

  /* Demo login — verifies against USERS_TRIAL.
     Returns { success, userId, userName, email, error? }. */
  login: function(id, pass) {
    return _jsonpRequest(API_URL + '?action=loginTrial'
      + '&id=' + encodeURIComponent(id)
      + '&pass=' + encodeURIComponent(pass));
  },

  /* Demo password recovery — generates a fresh temp password,
     stores it, and emails the user. They must change it on next
     login (server enforces TTL).
     Returns { success, error? }. */
  recover: function(email) {
    return _jsonpRequest(API_URL + '?action=recoverTrialPass'
      + '&email=' + encodeURIComponent(email));
  },

  /* Save a completed practice attempt to the shared ANSWERS sheet.
     Trial users live in USERS_TRIAL, but answers are written to the
     same sheet as paid users — verifyAnyUser_ on the server reads
     either pool so each user only sees their own data.
     `setName` is e.g. "CTW P1 Set 1", "Email P1", "SAT R&W · test1".

     Reads the user via Auth (tck_demo_user) and falls back to the
     legacy kickstart_user key so the same client works whether it's
     dropped into TCK Reps Demo or SAT Reps Demo. */
  saveAnswers: function(setName, answers, score, meta) {
    var user = {};
    try {
      if (typeof Auth !== 'undefined' && Auth.getUser) user = Auth.getUser() || {};
      if (!user || !user.userId) {
        user = JSON.parse(sessionStorage.getItem('tck_demo_user')
                       || sessionStorage.getItem('kickstart_user') || '{}');
      }
    } catch(e) { user = {}; }
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
  },

  /* Student-side: fetch the logged-in trial user's own past attempts
     for a specific (task, practice [, set]). GAS forces userId equal
     to the verified user so callers can't read someone else's data. */
  getMyAnswers: function(task, practice, set, id, pass) {
    var u = JSON.parse(sessionStorage.getItem('kickstart_user') || '{}');
    var p = pass || sessionStorage.getItem('kickstart_pass') || '';
    return _jsonpRequest(API_URL + '?action=getMyAnswers'
      + '&id='       + encodeURIComponent(id || u.userId || '')
      + '&pass='     + encodeURIComponent(p)
      + '&task='     + encodeURIComponent(task)
      + '&practice=' + encodeURIComponent(practice)
      + '&set='      + encodeURIComponent(set || ''));
  },

  /* Returns the trial user's own recordings (RECORDINGS / RECORDINGS_PT
     filtered server-side). Currently unused — demo speaking pages don't
     upload to GAS — but wired so student-history.js can render an
     empty Speaking section gracefully and so future demo enhancements
     don't need another API change. */
  listMyRecordings: function(id, pass) {
    var u = JSON.parse(sessionStorage.getItem('kickstart_user') || '{}');
    var p = pass || sessionStorage.getItem('kickstart_pass') || '';
    return _jsonpRequest(API_URL + '?action=listMyRecordings'
      + '&id='   + encodeURIComponent(id || u.userId || '')
      + '&pass=' + encodeURIComponent(p));
  }
};
