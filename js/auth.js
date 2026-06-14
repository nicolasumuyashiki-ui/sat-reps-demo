/* ============================================================
   TCK Reps for SAT (Demo) — Auth
   ============================================================
   SAT demo auth is a SEPARATE pool from the TOEFL Reps demo.
   It talks to the signupSat / loginSat / recoverSatPass endpoints
   (USERS_SAT sheet) and stores its session under `tck_sat_user`,
   distinct from the TOEFL demo's `tck_demo_user`. A person who
   signed up for the TOEFL demo (or for the paid TCK Reps course)
   is NOT automatically logged in here — they must create or use a
   SAT account.
   ============================================================ */

function tckRootPrefix() {
  var scripts = document.getElementsByTagName('script');
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].src || '';
    var m = src.match(/^(.*\/)js\/auth\.js(?:\?.*)?$/);
    if (m) return m[1];
  }
  return '';
}

var Auth = {
  /* SAT-only session key. Intentionally different from the TOEFL
     demo's `tck_demo_user` so the two demos never share a login. */
  SESSION_KEY: 'tck_sat_user',

  require: function() {
    if (!this.getUser()) {
      var ret = encodeURIComponent(location.pathname + location.search);
      location.replace(tckRootPrefix() + 'login.html?return=' + ret);
      return false;
    }
    return true;
  },

  getUser: function() {
    try {
      var u = JSON.parse(sessionStorage.getItem(this.SESSION_KEY));
      return u && u.userId ? u : null;
    } catch (e) {
      return null;
    }
  },

  setUser: function(u) {
    sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(u));
  },

  logout: function() {
    sessionStorage.removeItem(this.SESSION_KEY);
    // Drop the stashed password used for authenticated reads.
    try { sessionStorage.removeItem('tck_sat_pass'); } catch (e) {}
    location.href = tckRootPrefix() + 'index.html';
  },

  showBadge: function(elId) {
    var u = this.getUser();
    if (!u) return;
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML =
      '<span class="avatar">' + (u.userName || '?').charAt(0).toUpperCase() + '</span>' +
      '<span>' + (u.userName || u.userId) + '</span>';
  }
};
