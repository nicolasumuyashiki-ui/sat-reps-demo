/* ============================================================
   SAT Reps Demo — Practice engine
   ============================================================
   Drives the one-module Reading & Writing practice flow:
     start → question N (× total) → end-of-module review → submit → results.

   Reads the bank from a JSON file (one per test_id). Mirrors TCK
   Reps' "vanilla JS, single global, no build" style — no
   framework, no bundler. Persists in-progress state to
   localStorage under a test_id-scoped key so a refresh resumes
   exactly where the student was, with the same time remaining,
   the same answers, flags, eliminations, highlights, notes, and
   tool preferences (hidden timer, text size, line focus, etc.).

   Public surface: SATPractice.boot({ testId, dataUrl, resultsUrl }).
   The results renderer reuses renderPassage / renderFigure /
   escapeHtml / applyEmphasis off this same object so the review
   screen and the live screen render the same passage HTML.
   ============================================================ */

var SATPractice = (function(){

  /* --------------------------------------------------------
     Constants
     -------------------------------------------------------- */
  var TEXT_SIZE_STEPS = [14, 15, 16, 17, 18, 20, 22];
  var DEFAULT_SIZE_IDX = 3;          // 17px — what TCK Reps uses for body type
  var LINE_FOCUS_WINDOW_PX = 60;     // height of the clear window between top/bottom shades

  /* --------------------------------------------------------
     Private state — single source of truth for the page.
     Anything renderable lives here; the DOM is derived.
     -------------------------------------------------------- */
  var state = {
    testId: null,
    test: null,
    questions: [],
    figuresById: {},
    currentIdx: 0,

    answers: {},           // { qNumStr: choiceIdx 0..3 }
    flags: {},             // { qNumStr: true }
    eliminations: {},      // { qNumStr: { choiceIdx: true } }

    /* Highlight + note persistence is per question. We store the
       passage-body innerHTML snapshot as the source of truth — the
       passage is deterministic so we overlay marks on top and round-
       trip cleanly. The notes live in attributes on the marks (so
       they survive the snapshot). */
    annotations: {},       // { qNumStr: { html: '...passage-body innerHTML...' } }

    /* Module-scoped tool preferences. Restored on resume. */
    prefs: {
      timerHidden: false,
      textSizeIdx: DEFAULT_SIZE_IDX,
      lineFocus: false,
      highlightMode: false
    },
    warn5Fired: false,     // 5-min modal only fires once per module

    timeRemaining: 0,
    timerId: null,
    startedAt: null,
    blurCount: 0,

    dataUrl: '',
    resultsUrl: ''
  };

  /* --------------------------------------------------------
     Storage helpers — scoped per test_id so multiple tests
     don't stomp each other. Cleared on final submit.
     -------------------------------------------------------- */
  function storageKey(){ return 'sat_reps:' + state.testId + ':progress'; }
  function resultsKey(){ return 'sat_reps:' + state.testId + ':results'; }

  function persist(){
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        currentIdx: state.currentIdx,
        answers: state.answers,
        flags: state.flags,
        eliminations: state.eliminations,
        annotations: state.annotations,
        prefs: state.prefs,
        warn5Fired: state.warn5Fired,
        timeRemaining: state.timeRemaining,
        startedAt: state.startedAt,
        blurCount: state.blurCount
      }));
    } catch(e){ /* quota or private mode — fail silent; session still works */ }
  }

  function restore(){
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || typeof s.timeRemaining !== 'number') return false;
      state.currentIdx    = clamp(s.currentIdx || 0, 0, state.questions.length - 1);
      state.answers       = s.answers || {};
      state.flags         = s.flags || {};
      state.eliminations  = s.eliminations || {};
      state.annotations   = s.annotations || {};
      state.prefs         = Object.assign({
        timerHidden: false, textSizeIdx: DEFAULT_SIZE_IDX,
        lineFocus: false, highlightMode: false
      }, s.prefs || {});
      state.warn5Fired    = !!s.warn5Fired;
      state.timeRemaining = Math.max(0, s.timeRemaining);
      state.startedAt     = s.startedAt || null;
      state.blurCount     = s.blurCount || 0;
      return true;
    } catch(e){ return false; }
  }

  function clearProgress(){
    try { localStorage.removeItem(storageKey()); } catch(e){}
  }

  function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }

  /* --------------------------------------------------------
     Boot: fetch the bank, restore any saved progress, wire
     the start screen. enterModule() takes over from there.
     -------------------------------------------------------- */
  function boot(opts){
    state.testId     = opts.testId;
    state.dataUrl    = opts.dataUrl;
    state.resultsUrl = opts.resultsUrl;

    loadJson(state.dataUrl).then(function(test){
      state.test = test;
      state.questions = Array.isArray(test.questions) ? test.questions : [];
      state.figuresById = {};
      (test.figures || []).forEach(function(f){ if (f && f.id) state.figuresById[f.id] = f; });

      var spec = document.getElementById('specCount');
      if (spec) spec.textContent = state.questions.length;

      var lang = (localStorage.getItem('tck_lang') || 'jp');
      var title = document.getElementById('startTitle');
      if (title && test['title_' + lang]) title.textContent = test['title_' + lang];
      else if (title && test.title_en) title.textContent = test.title_en;

      var resumed = restore();
      if (!resumed) {
        state.currentIdx = 0;
        state.timeRemaining = (window.SAT_CONFIG && SAT_CONFIG.moduleSeconds) || (32 * 60);
      } else {
        var note = document.getElementById('resumeNote');
        if (note) note.hidden = false;
        var btn = document.getElementById('startBtn');
        if (btn) {
          btn.innerHTML = (lang === 'en'
            ? 'Resume module <span class="arrow">→</span>'
            : '演習を再開する <span class="arrow">→</span>');
        }
      }
      wireStartScreen();
    }).catch(function(err){
      alert('問題バンクの読み込みに失敗しました: ' + err.message);
    });
  }

  function loadJson(url){
    return fetch(url, { cache: 'no-store' }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status + ' loading ' + url);
      return r.json();
    });
  }

  /* --------------------------------------------------------
     Start screen → enter the module
     -------------------------------------------------------- */
  function wireStartScreen(){
    var btn = document.getElementById('startBtn');
    if (btn) btn.addEventListener('click', enterModule);
  }

  function enterModule(){
    if (!state.startedAt) state.startedAt = Date.now();

    document.body.setAttribute('data-screen', 'question');
    document.getElementById('topNav').hidden = false;
    document.getElementById('screenStart').hidden = true;
    document.getElementById('screenQuestion').hidden = false;

    wireTopNav();
    wireTools();
    wireOverlays();
    wireKeyboard();
    wireVisibility();
    LineFocus.init();
    Highlights.init();
    wireSize();

    /* Apply restored prefs to the UI */
    applyTextSize(state.prefs.textSizeIdx || DEFAULT_SIZE_IDX);
    Highlights.setMode(!!state.prefs.highlightMode);
    LineFocus.set(!!state.prefs.lineFocus);
    setTimerHidden(!!state.prefs.timerHidden);

    renderCurrent();
    startTimer();
    persist();
  }

  /* --------------------------------------------------------
     Top-nav wiring (flag, navigator, finish, timer-eye)
     -------------------------------------------------------- */
  function wireTopNav(){
    document.getElementById('flagBtn').addEventListener('click', toggleFlag);
    document.getElementById('navBtn').addEventListener('click', openNavigator);
    document.getElementById('finishBtn').addEventListener('click', function(){
      openConfirm(buildSubmitConfirm());
    });
    document.getElementById('prevBtn').addEventListener('click', function(){ goTo(state.currentIdx - 1); });
    /* The Next button's handler is reassigned in renderCurrent() so
       the last question's Next becomes "Final review →" instead. */

    document.getElementById('timerEyeBtn').addEventListener('click', function(){ toggleTimerHidden(); });

    document.getElementById('highlightBtn').addEventListener('click', function(){
      Highlights.setMode(!state.prefs.highlightMode);
    });

    /* End-of-module review screen actions */
    document.getElementById('erBackBtn').addEventListener('click', leaveEndReview);
    document.getElementById('erSubmitBtn').addEventListener('click', function(){
      openConfirm(buildSubmitConfirm());
    });
  }

  function wireOverlays(){
    document.querySelectorAll('[data-overlay-close]').forEach(function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-overlay-close');
        var ov = document.getElementById(id);
        if (ov) ov.classList.remove('active');
      });
    });
    document.getElementById('navGoEndBtn').addEventListener('click', function(){
      document.getElementById('navOverlay').classList.remove('active');
      goToEndReview();
    });
    document.getElementById('confirmSubmitBtn').addEventListener('click', function(){
      document.getElementById('confirmOverlay').classList.remove('active');
      submit({ reason: 'manual' });
    });
    document.getElementById('timeupContinueBtn').addEventListener('click', function(){
      document.getElementById('timeupOverlay').classList.remove('active');
      location.href = state.resultsUrl;
    });

    /* ESC closes any open overlay. */
    document.addEventListener('keydown', function(e){
      if (e.key !== 'Escape') return;
      ['navOverlay','confirmOverlay','dirOverlay','shortcutsOverlay','helpOverlay','sizeOverlay','warn5Overlay'].forEach(function(id){
        var ov = document.getElementById(id);
        if (ov && ov.classList.contains('active')) ov.classList.remove('active');
      });
      Highlights.hidePopovers();
    });
  }

  /* --------------------------------------------------------
     Tools dropdown
     -------------------------------------------------------- */
  function wireTools(){
    var btn  = document.getElementById('toolsBtn');
    var menu = document.getElementById('toolsMenu');
    function toggle(force){
      var willOpen = (typeof force === 'boolean') ? force : menu.hidden;
      menu.hidden = !willOpen;
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }
    btn.addEventListener('click', function(e){ e.stopPropagation(); toggle(); });
    document.addEventListener('mousedown', function(e){
      if (menu.hidden) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      toggle(false);
    });
    menu.querySelectorAll('[data-tool]').forEach(function(item){
      item.addEventListener('click', function(){
        var tool = item.getAttribute('data-tool');
        toggle(false);
        if (tool === 'line-focus')      LineFocus.set(!state.prefs.lineFocus);
        else if (tool === 'text-size')  openOverlay('sizeOverlay');
        else if (tool === 'directions') openDirections();
        else if (tool === 'shortcuts')  openOverlay('shortcutsOverlay');
        else if (tool === 'help')       openOverlay('helpOverlay');
      });
    });
  }

  function openOverlay(id){ var ov = document.getElementById(id); if (ov) ov.classList.add('active'); }

  function openDirections(){
    /* Clone the start-screen directions into the modal body once. */
    var src = document.getElementById('startDirections');
    var dst = document.getElementById('dirBody');
    if (src && dst && !dst.childNodes.length){
      dst.innerHTML = src.innerHTML;
    }
    openOverlay('dirOverlay');
  }

  /* --------------------------------------------------------
     Keyboard shortcuts.
       1-4 / A-D                : pick that choice
       Shift+1-4                : eliminate / un-eliminate that choice
       ← / →                    : prev / next (or → review on the last item)
       F                        : toggle flag
       R                        : open navigator
       H                        : toggle highlight mode
       L                        : toggle line focus
       T                        : hide / show timer
       + / - / 0                : text size up / down / reset
       ?                        : reopen directions
       Esc                      : close any modal (handled in wireOverlays)
     -------------------------------------------------------- */
  function wireKeyboard(){
    document.addEventListener('keydown', function(e){
      /* Don't intercept while a text input is focused (note editor, etc.). */
      var tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.target && e.target.isContentEditable) return;

      /* Skip if any overlay is open — let ESC + their own buttons drive. */
      var anyOpen = ['navOverlay','confirmOverlay','dirOverlay','shortcutsOverlay','helpOverlay','sizeOverlay','warn5Overlay']
        .some(function(id){ var o = document.getElementById(id); return o && o.classList.contains('active'); });
      if (anyOpen && e.key !== 'Escape') return;

      var k = e.key;

      /* Shift + Digit 1..4 → toggle eliminate. Use e.code for portability
         (Shift+1 on a US layout produces "!"; e.code is reliable). */
      if (e.shiftKey && /^Digit[1-4]$/.test(e.code)){
        toggleEliminated(parseInt(e.code.slice(-1), 10) - 1);
        e.preventDefault(); return;
      }
      if (e.shiftKey) return;  // other shifted combos: leave to the browser

      if (k === 'ArrowLeft')  { goTo(state.currentIdx - 1); e.preventDefault(); return; }
      if (k === 'ArrowRight') {
        if (state.currentIdx === state.questions.length - 1) goToEndReview();
        else goTo(state.currentIdx + 1);
        e.preventDefault(); return;
      }
      if (k === 'f' || k === 'F') { toggleFlag(); e.preventDefault(); return; }
      if (k === 'r' || k === 'R') { openNavigator(); e.preventDefault(); return; }
      if (k === 'h' || k === 'H') { Highlights.setMode(!state.prefs.highlightMode); e.preventDefault(); return; }
      if (k === 'l' || k === 'L') { LineFocus.set(!state.prefs.lineFocus); e.preventDefault(); return; }
      if (k === 't' || k === 'T') { toggleTimerHidden(); e.preventDefault(); return; }
      if (k === '+' || k === '=') { nudgeSize(1); e.preventDefault(); return; }
      if (k === '-' || k === '_') { nudgeSize(-1); e.preventDefault(); return; }
      if (k === '0')              { applyTextSize(DEFAULT_SIZE_IDX); e.preventDefault(); return; }
      if (k === '?')              { openDirections(); e.preventDefault(); return; }
      if (/^[1-4]$/.test(k))      { selectChoice(parseInt(k,10) - 1); e.preventDefault(); return; }
      if (/^[a-dA-D]$/.test(k))   { selectChoice(k.toUpperCase().charCodeAt(0) - 65); e.preventDefault(); return; }
    });
  }

  /* --------------------------------------------------------
     Visibility / blur tracking — soft anti-cheat signal we
     stash with the submission so the server can flag
     suspicious sittings. Does NOT prevent anything.
     -------------------------------------------------------- */
  function wireVisibility(){
    document.addEventListener('visibilitychange', function(){
      if (document.hidden) {
        state.blurCount = (state.blurCount || 0) + 1;
        persist();
      }
    });
  }

  /* --------------------------------------------------------
     Timer + the timer-hide toggle + the 5-min warning
     -------------------------------------------------------- */
  function startTimer(){
    stopTimer();
    paintTimer();
    state.timerId = setInterval(function(){
      state.timeRemaining = Math.max(0, state.timeRemaining - 1);
      paintTimer();
      maybeFireWarn5();
      if (state.timeRemaining % 5 === 0) persist();
      if (state.timeRemaining <= 0) { stopTimer(); autoSubmit(); }
    }, 1000);
  }

  function stopTimer(){ if (state.timerId) { clearInterval(state.timerId); state.timerId = null; } }

  function paintTimer(){
    var el = document.getElementById('timer');
    if (!el) return;
    el.textContent = formatTime(state.timeRemaining);
    var warn = (window.SAT_CONFIG && SAT_CONFIG.warnUnderSeconds) || 300;
    el.classList.toggle('warn', state.timeRemaining <= warn && state.timeRemaining > 60);
    el.classList.toggle('crit', state.timeRemaining <= 60);
  }

  function maybeFireWarn5(){
    if (state.warn5Fired) return;
    var warn = (window.SAT_CONFIG && SAT_CONFIG.warnUnderSeconds) || 300;
    if (state.timeRemaining === warn) {
      state.warn5Fired = true;
      openOverlay('warn5Overlay');
      persist();
    }
  }

  function toggleTimerHidden(force){
    var hide = (typeof force === 'boolean') ? force : !state.prefs.timerHidden;
    setTimerHidden(hide);
  }
  function setTimerHidden(hide){
    state.prefs.timerHidden = !!hide;
    var timerEl = document.getElementById('timer');
    var eye     = document.getElementById('timerEyeBtn');
    if (timerEl) timerEl.classList.toggle('hidden-digits', !!hide);
    if (eye)     eye.setAttribute('aria-pressed', hide ? 'true' : 'false');
    persist();
  }

  function formatTime(s){
    var mm = Math.floor(s / 60);
    var ss = s % 60;
    return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  /* --------------------------------------------------------
     Text-size tool — drives the --passage-fs CSS variable.
     -------------------------------------------------------- */
  function applyTextSize(idx){
    idx = clamp(idx, 0, TEXT_SIZE_STEPS.length - 1);
    state.prefs.textSizeIdx = idx;
    document.documentElement.style.setProperty('--passage-fs', TEXT_SIZE_STEPS[idx] + 'px');
    /* Update modal button highlight */
    document.querySelectorAll('[data-size]').forEach(function(b){ b.classList.remove('is-active'); });
    if (idx === DEFAULT_SIZE_IDX) {
      var def = document.querySelector('[data-size="0"]'); if (def) def.classList.add('is-active');
    }
    persist();
  }
  function nudgeSize(delta){ applyTextSize((state.prefs.textSizeIdx == null ? DEFAULT_SIZE_IDX : state.prefs.textSizeIdx) + delta); }

  function wireSize(){
    document.querySelectorAll('[data-size]').forEach(function(b){
      b.addEventListener('click', function(){
        var k = b.getAttribute('data-size');
        if (k === '+')      nudgeSize(1);
        else if (k === '-') nudgeSize(-1);
        else                applyTextSize(DEFAULT_SIZE_IDX);
      });
    });
  }

  /* --------------------------------------------------------
     Line Focus tool — two shaded panels follow the cursor Y;
     a clear `LINE_FOCUS_WINDOW_PX`-tall window sits between.
     -------------------------------------------------------- */
  var LineFocus = (function(){
    var elTop, elBot, elWrap, attached = false;

    function onMove(e){
      if (!state.prefs.lineFocus) return;
      var y = e.clientY;
      var half = LINE_FOCUS_WINDOW_PX / 2;
      var clearTop = Math.max(0, y - half);
      var clearBot = Math.min(window.innerHeight, y + half);
      elTop.style.height = clearTop + 'px';
      elBot.style.height = Math.max(0, window.innerHeight - clearBot) + 'px';
    }
    function init(){
      elWrap = document.getElementById('lineFocus');
      elTop  = document.getElementById('lfTop');
      elBot  = document.getElementById('lfBottom');
      if (attached) return;
      document.addEventListener('mousemove', onMove);
      attached = true;
    }
    function set(on){
      state.prefs.lineFocus = !!on;
      if (elWrap) elWrap.hidden = !on;
      document.body.classList.toggle('lf-active', !!on);
      var item = document.querySelector('.tn-menu-item[data-tool="line-focus"]');
      if (item) item.classList.toggle('is-on', !!on);
      var lab = document.getElementById('lineFocusState');
      if (lab) lab.textContent = on ? 'ON' : '';
      persist();
    }
    return { init: init, set: set };
  })();

  /* --------------------------------------------------------
     Highlights & Notes — selecting passage text while in
     highlight mode reveals a small popover; choose a color to
     wrap the selection in a <mark.hl.hl-COLOR>, choose Note to
     attach a short string to that mark, Clear to unwrap.
     Persistence: after every change we snapshot the
     passage-body innerHTML into state.annotations[qNum].html.
     -------------------------------------------------------- */
  var Highlights = (function(){
    var POP, NOTE, NOTE_TXT, ACTIVE = null;

    function init(){
      POP      = document.getElementById('hiPopover');
      NOTE     = document.getElementById('hiNotePopover');
      NOTE_TXT = document.getElementById('hiNoteText');

      POP.querySelectorAll('[data-hi]').forEach(function(btn){
        /* mousedown PreventDefault preserves the active text selection
           that the user just made — otherwise clicking the popover
           collapses it and we lose the range. */
        btn.addEventListener('mousedown', function(e){ e.preventDefault(); });
        btn.addEventListener('click', function(){
          handlePopAction(btn.getAttribute('data-hi'));
        });
      });
      document.getElementById('hiNoteSave').addEventListener('click', saveNote);
      document.getElementById('hiNoteDelete').addEventListener('click', deleteNote);

      document.addEventListener('selectionchange', maybeShowPop);
      document.getElementById('passagePane').addEventListener('click', onPassageClick);

      /* Click outside any of our popovers / marks → hide. */
      document.addEventListener('mousedown', function(e){
        if (POP.contains(e.target)) return;
        if (NOTE.contains(e.target)) return;
        if (e.target.closest && e.target.closest('mark.hl')) return;
        hidePopovers();
      });

      /* Reposition popovers if the passage pane scrolls or the window resizes. */
      window.addEventListener('resize', hidePopovers);
      var pp = document.getElementById('passagePane');
      pp.addEventListener('scroll', hidePopovers);
    }

    function setMode(on){
      state.prefs.highlightMode = !!on;
      var btn = document.getElementById('highlightBtn');
      if (btn){
        btn.classList.toggle('hi-on', !!on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      if (!on) hidePopovers();
      persist();
    }

    function getBody(){ return document.getElementById('passageBody'); }

    function maybeShowPop(){
      if (!state.prefs.highlightMode) return;
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hidePop(); return; }
      var range = sel.getRangeAt(0);
      var body = getBody();
      if (!body || !body.contains(range.commonAncestorContainer)) { hidePop(); return; }
      showPopAtRange(range);
    }

    function showPopAtRange(range){
      ACTIVE = null;
      POP.hidden = false;
      /* Position above the selection, clamped to viewport. */
      var rect = range.getBoundingClientRect();
      placePopover(POP, rect.left + rect.width/2, rect.top - 12, /*above*/true);
    }
    function showPopAtMark(mark){
      ACTIVE = mark;
      POP.hidden = false;
      document.querySelectorAll('mark.hl-active').forEach(function(m){ m.classList.remove('hl-active'); });
      mark.classList.add('hl-active');
      var rect = mark.getBoundingClientRect();
      placePopover(POP, rect.left + rect.width/2, rect.top - 12, /*above*/true);
    }
    function placePopover(el, cx, cy, above){
      /* Render off-screen first so we can measure */
      el.style.left = '-9999px';
      el.style.top  = '0px';
      var w = el.offsetWidth, h = el.offsetHeight;
      var left = cx - w/2 + window.scrollX;
      var top  = (above ? cy - h : cy) + window.scrollY;
      left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
      top  = Math.max(8, top);
      el.style.left = left + 'px';
      el.style.top  = top + 'px';
    }

    function hidePop(){ if (POP) POP.hidden = true; ACTIVE = null;
      document.querySelectorAll('mark.hl-active').forEach(function(m){ m.classList.remove('hl-active'); });
    }
    function hidePopovers(){ hidePop(); if (NOTE) NOTE.hidden = true; }

    function onPassageClick(e){
      var mark = e.target.closest && e.target.closest('mark.hl');
      if (!mark) return;
      e.stopPropagation();
      showPopAtMark(mark);
      if (mark.dataset.note) showNoteEditorFor(mark);
    }

    function handlePopAction(action){
      var sel = window.getSelection();
      if (action === 'clear'){
        if (ACTIVE){
          clearMark(ACTIVE); ACTIVE = null;
        } else if (sel && !sel.isCollapsed){
          clearMarksInRange(sel.getRangeAt(0));
          sel.removeAllRanges();
        }
        hidePopovers(); snapshotPassage();
        return;
      }
      if (action === 'note'){
        if (!ACTIVE){
          /* If no active mark, first wrap selection in yellow, then attach a note */
          var made = (sel && !sel.isCollapsed) ? wrapRange(sel.getRangeAt(0), 'yellow') : [];
          if (sel) sel.removeAllRanges();
          if (made.length){
            ACTIVE = made[0];
            ACTIVE.classList.add('hl-active');
            snapshotPassage();
          }
        }
        if (ACTIVE) showNoteEditorFor(ACTIVE);
        return;
      }
      /* Otherwise: a color swatch */
      var color = action;
      if (ACTIVE){
        ACTIVE.className = 'hl hl-' + color + (ACTIVE.dataset.note ? '' : '');
        ACTIVE.classList.add('hl-active');
        snapshotPassage();
        hidePop();
      } else if (sel && !sel.isCollapsed){
        wrapRange(sel.getRangeAt(0), color);
        sel.removeAllRanges();
        snapshotPassage();
        hidePop();
      }
    }

    /* Wrap a Range in <mark class="hl hl-COLOR"> tags. Handles
       cross-element ranges by splitting per-text-node and wrapping
       each piece. Returns the array of new <mark> elements. */
    function wrapRange(range, color){
      var body = getBody();
      if (!body || !body.contains(range.commonAncestorContainer)) return [];

      /* Snapshot the per-node start/end BEFORE splitting, because
         splitText mutates and invalidates the live offsets. */
      var textNodes = collectTextNodes(range, body);
      var ops = textNodes.map(function(n){
        return {
          node:  n,
          start: (n === range.startContainer) ? range.startOffset : 0,
          end:   (n === range.endContainer)   ? range.endOffset   : n.nodeValue.length
        };
      });

      var marks = [];
      ops.forEach(function(op){
        var n = op.node, s = op.start, e = op.end;
        if (s === e) return;
        /* Don't re-wrap inside an existing mark — easier to ignore and
           let the student clear first. */
        if (n.parentNode && n.parentNode.nodeName === 'MARK' && n.parentNode.classList.contains('hl')) return;
        var target = n;
        if (e < target.nodeValue.length) target.splitText(e);
        if (s > 0) target = target.splitText(s);
        var mark = document.createElement('mark');
        mark.className = 'hl hl-' + color + ' hl-just-added';
        mark.dataset.hlId = (Date.now().toString(36) + Math.random().toString(36).slice(2,5));
        target.parentNode.insertBefore(mark, target);
        mark.appendChild(target);
        marks.push(mark);
      });
      /* Drop the just-added animation class after one frame so a second
         highlight in the same spot still animates. */
      setTimeout(function(){ marks.forEach(function(m){ m.classList.remove('hl-just-added'); }); }, 260);
      return marks;
    }

    function collectTextNodes(range, root){
      var nodes = [];
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function(node){
          if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
          /* Skip text nodes inside the SVG figure block — we don't
             highlight axis labels. */
          if (node.parentNode && node.parentNode.closest && node.parentNode.closest('.figure-block')) return NodeFilter.FILTER_REJECT;
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      var n; while ((n = walker.nextNode())) nodes.push(n);
      return nodes;
    }

    function clearMark(mark){
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize && parent.normalize();
    }
    function clearMarksInRange(range){
      var body = getBody(); if (!body) return;
      var list = [];
      body.querySelectorAll('mark.hl').forEach(function(m){ if (range.intersectsNode(m)) list.push(m); });
      list.forEach(clearMark);
    }

    function showNoteEditorFor(mark){
      ACTIVE = mark;
      NOTE.hidden = false;
      var rect = mark.getBoundingClientRect();
      placePopover(NOTE, rect.left + rect.width/2, rect.bottom + 4, /*above*/false);
      NOTE_TXT.value = mark.dataset.note || '';
      setTimeout(function(){ NOTE_TXT.focus(); }, 30);
    }
    function saveNote(){
      if (!ACTIVE) return hidePopovers();
      var t = NOTE_TXT.value.trim();
      if (t) ACTIVE.dataset.note = t;
      else delete ACTIVE.dataset.note;
      hidePopovers(); snapshotPassage();
    }
    function deleteNote(){
      if (!ACTIVE) return hidePopovers();
      delete ACTIVE.dataset.note;
      hidePopovers(); snapshotPassage();
    }

    return { init: init, setMode: setMode, hidePopovers: hidePopovers };
  })();

  function snapshotPassage(){
    var body = document.getElementById('passageBody');
    if (!body) return;
    var q = currentQ(); if (!q) return;
    var key = String(q.num);
    if (!state.annotations[key]) state.annotations[key] = {};
    state.annotations[key].html = body.innerHTML;
    persist();
  }

  /* --------------------------------------------------------
     Question rendering
     -------------------------------------------------------- */
  function currentQ(){ return state.questions[state.currentIdx]; }

  function renderCurrent(){
    var q = currentQ();
    if (!q) return;
    var qKey = String(q.num);

    document.getElementById('qNumBadge').textContent = 'Q ' + q.num;
    /* During the live module, don't leak the canonical skill label
       (it can tip the student to the question type). Show the domain
       only; the full skill label is restored on Results. */
    document.getElementById('qSkillTag').textContent = q.domain || '';

    var pp = document.getElementById('passagePane');
    pp.innerHTML = '';
    if (q.figure && state.figuresById[q.figure]) {
      pp.innerHTML += renderFigure(state.figuresById[q.figure]);
    }
    /* Wrap the highlightable text in #passageBody. Restore the
       saved snapshot (with marks) if we have one for this question. */
    var saved = state.annotations[qKey];
    var bodyHtml = (saved && saved.html) ? saved.html : renderPassage(q.passage || '');
    pp.innerHTML += '<div class="passage-body" id="passageBody">' + bodyHtml + '</div>';

    document.getElementById('qStem').textContent = q.stem || '';

    /* Choices */
    var letters = ['A','B','C','D'];
    var chosenIdx = (qKey in state.answers) ? state.answers[qKey] : -1;
    var elim = state.eliminations[qKey] || {};
    var html = '';
    (q.choices || []).forEach(function(text, idx){
      var sel = (idx === chosenIdx) ? ' selected' : '';
      var elimCls = elim[idx] ? ' eliminated' : '';
      html += ''
        + '<div class="choice' + sel + elimCls + '" role="radio" tabindex="0" aria-checked="' + (idx === chosenIdx) + '" data-choice="' + idx + '">'
        +   '<span class="ch-letter">' + letters[idx] + '</span>'
        +   '<span class="ch-text">' + escapeHtml(text) + '</span>'
        +   '<button type="button" class="ch-strike" data-strike="' + idx + '" aria-label="Eliminate this choice" title="Eliminate / un-eliminate">⊘</button>'
        + '</div>';
    });
    var box = document.getElementById('choices');
    box.innerHTML = html;
    box.querySelectorAll('.choice').forEach(function(btn){
      function activate(e){
        if (e.target && e.target.classList.contains('ch-strike')) return;
        selectChoice(parseInt(btn.getAttribute('data-choice'), 10));
      }
      btn.addEventListener('click', activate);
      btn.addEventListener('keydown', function(e){
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); activate(e); }
      });
    });
    box.querySelectorAll('.ch-strike').forEach(function(s){
      s.addEventListener('click', function(e){
        e.stopPropagation();
        toggleEliminated(parseInt(s.getAttribute('data-strike'), 10));
      });
    });

    /* Prev / Next — on the last question, Next becomes "Final review →" */
    document.getElementById('prevBtn').disabled = (state.currentIdx === 0);
    var isLast = (state.currentIdx === state.questions.length - 1);
    var nextBtn = document.getElementById('nextBtn');
    if (isLast){
      nextBtn.innerHTML = '<span class="jp">最終チェックへ</span><span class="en">Final review</span> →';
      nextBtn.onclick = function(){ goToEndReview(); };
      nextBtn.disabled = false;
    } else {
      nextBtn.innerHTML = '<span class="jp">次へ</span><span class="en">Next</span> →';
      nextBtn.onclick = function(){ goTo(state.currentIdx + 1); };
      nextBtn.disabled = false;
    }
    document.getElementById('navProgress').textContent = (state.currentIdx + 1) + ' / ' + state.questions.length;

    paintFlagBtn();

    document.getElementById('passagePane').scrollTop = 0;
    document.querySelector('.question-pane').scrollTop = 0;

    Highlights.hidePopovers();
  }

  function renderPassage(passage){
    var lines = String(passage).split('\n');
    var html = '';
    var paraBuf = [];
    var inBullets = false;
    function flushPara(){ if (paraBuf.length){ html += '<p>' + paraBuf.map(applyEmphasis).join(' ') + '</p>'; paraBuf = []; } }
    function openBullets(){ if (!inBullets){ flushPara(); html += '<ul class="note-bullets">'; inBullets = true; } }
    function closeBullets(){ if (inBullets){ html += '</ul>'; inBullets = false; } }

    for (var i = 0; i < lines.length; i++){
      var line = lines[i], trimmed = line.trim();
      if (trimmed === '') { closeBullets(); flushPara(); continue; }
      if (/^Text\s+\d+$/i.test(trimmed)) {
        closeBullets(); flushPara();
        html += '<span class="ct-label">' + escapeHtml(trimmed) + '</span>';
        continue;
      }
      if (/^[-•]\s+/.test(trimmed)) {
        openBullets();
        html += '<li>' + applyEmphasis(trimmed.replace(/^[-•]\s+/, '')) + '</li>';
        continue;
      }
      closeBullets();
      paraBuf.push(line);
    }
    flushPara();
    closeBullets();
    return html;
  }

  function applyEmphasis(s){
    return escapeHtml(s).replace(/\*([^*\n]+)\*/g, '<em class="emph">$1</em>');
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"]/g, function(c){
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c];
    });
  }

  function renderFigure(f){
    var html = '<div class="figure-block">';
    html += '<div class="figure-title">' + escapeHtml(f.title || '') + '</div>';
    if (f.type === 'bar') html += renderBarSvg(f);
    else html += renderTable(f);
    if (f.caption) html += '<div class="figure-caption">' + escapeHtml(f.caption) + '</div>';
    html += '</div>';
    return html;
  }

  function renderBarSvg(f){
    var series = f.series || [];
    if (!series.length) return '';
    var W = 460, H = 240;
    var padL = 48, padR = 14, padT = 14, padB = 60;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxV = series.reduce(function(m, s){ return Math.max(m, +s.value || 0); }, 0);
    if (maxV <= 0) maxV = 1;
    var step = Math.pow(10, Math.floor(Math.log10(maxV))) / 2;
    var axisMax = Math.ceil(maxV / step) * step; if (axisMax === 0) axisMax = maxV;
    var barW = plotW / series.length * 0.62;
    var gap  = plotW / series.length * 0.38;

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + escapeHtml(f.title || 'chart') + '" style="width:100%;height:auto;max-width:520px">';
    svg += '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (H - padB) + '" stroke="#5A6861" stroke-width="1"/>';
    svg += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="#5A6861" stroke-width="1"/>';
    var ticks = 4;
    for (var t = 0; t <= ticks; t++){
      var v = axisMax * (t / ticks);
      var y = (H - padB) - (plotH * (t / ticks));
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#D6DAD7" stroke-width="1" stroke-dasharray="2,3"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" font-size="10" fill="#5A6861" text-anchor="end" font-family="Manrope,sans-serif">' + Math.round(v * 10) / 10 + '</text>';
    }
    series.forEach(function(s, i){
      var x = padL + i * (barW + gap) + gap / 2;
      var hh = Math.max(1, (s.value / axisMax) * plotH);
      var y = (H - padB) - hh;
      svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + hh + '" fill="#007646" rx="2"/>';
      svg += '<text x="' + (x + barW / 2) + '" y="' + (y - 4) + '" font-size="10" fill="#0F1511" text-anchor="middle" font-weight="700" font-family="Manrope,sans-serif">' + s.value + '</text>';
      var label = String(s.label || ''), words = label.split(/\s+/);
      var mid = Math.ceil(words.length / 2);
      var line1 = words.slice(0, mid).join(' '), line2 = words.slice(mid).join(' ');
      var lx = x + barW / 2, ly = H - padB + 14;
      svg += '<text x="' + lx + '" y="' + ly + '" font-size="10" fill="#5A6861" text-anchor="middle" font-family="Manrope,sans-serif">' + escapeHtml(line1) + '</text>';
      if (line2) svg += '<text x="' + lx + '" y="' + (ly + 12) + '" font-size="10" fill="#5A6861" text-anchor="middle" font-family="Manrope,sans-serif">' + escapeHtml(line2) + '</text>';
    });
    if (f.y_label) svg += '<text transform="rotate(-90 14 ' + (H/2) + ')" x="14" y="' + (H/2) + '" font-size="10" fill="#5A6861" text-anchor="middle" font-family="Manrope,sans-serif">' + escapeHtml(f.y_label) + '</text>';
    if (f.x_label) svg += '<text x="' + (W/2) + '" y="' + (H - 4) + '" font-size="10" fill="#5A6861" text-anchor="middle" font-family="Manrope,sans-serif">' + escapeHtml(f.x_label) + '</text>';
    svg += '</svg>';
    return svg;
  }

  function renderTable(f){
    var rows = f.series || f.rows || [];
    if (!rows.length) return '<div style="color:var(--ink-500);font-size:.85em">(no data)</div>';
    var html = '<table style="width:100%;border-collapse:collapse;font-size:.86em;font-family:Manrope,sans-serif">';
    html += '<thead><tr>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1.5px solid #5A6861">' + escapeHtml(f.x_label || 'Category') + '</th>'
      + '<th style="text-align:right;padding:6px 8px;border-bottom:1.5px solid #5A6861">' + escapeHtml(f.y_label || 'Value') + '</th>'
      + '</tr></thead><tbody>';
    rows.forEach(function(r){
      html += '<tr>'
        + '<td style="padding:5px 8px;border-bottom:1px solid #D6DAD7">' + escapeHtml(r.label || '') + '</td>'
        + '<td style="padding:5px 8px;border-bottom:1px solid #D6DAD7;text-align:right">' + escapeHtml(String(r.value)) + '</td>'
        + '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /* --------------------------------------------------------
     Interactions
     -------------------------------------------------------- */
  function selectChoice(idx){
    var q = currentQ(); if (!q) return;
    if (idx < 0 || idx >= (q.choices || []).length) return;
    var key = String(q.num);
    if (state.answers[key] === idx) delete state.answers[key];
    else state.answers[key] = idx;
    persist();
    renderCurrent();
  }
  function toggleEliminated(idx){
    var q = currentQ(); if (!q) return;
    if (idx < 0 || idx >= (q.choices || []).length) return;
    var key = String(q.num);
    if (!state.eliminations[key]) state.eliminations[key] = {};
    if (state.eliminations[key][idx]) delete state.eliminations[key][idx];
    else state.eliminations[key][idx] = true;
    persist(); renderCurrent();
  }
  function toggleFlag(){
    var q = currentQ(); if (!q) return;
    var key = String(q.num);
    if (state.flags[key]) delete state.flags[key];
    else state.flags[key] = true;
    persist(); paintFlagBtn();
  }
  function paintFlagBtn(){
    var q = currentQ();
    var btn = document.getElementById('flagBtn');
    if (!q || !btn) return;
    var on = !!state.flags[String(q.num)];
    btn.classList.toggle('flag-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function goTo(idx){
    if (idx < 0 || idx >= state.questions.length) return;
    /* If we were on the end-review screen, leave it. */
    if (document.body.getAttribute('data-screen') === 'endreview') leaveEndReview();
    state.currentIdx = idx;
    persist(); renderCurrent();
  }

  /* --------------------------------------------------------
     Navigator overlay
     -------------------------------------------------------- */
  function openNavigator(){ paintNavigator(); openOverlay('navOverlay'); }
  function paintNavigator(){
    var grid = document.getElementById('navGrid');
    grid.innerHTML = '';
    var answered = 0, flagged = 0;
    state.questions.forEach(function(q, i){
      var key = String(q.num);
      var isAns = (key in state.answers), isFlag = !!state.flags[key];
      if (isAns) answered++;
      if (isFlag) flagged++;
      var cls = ['nav-cell'];
      if (isAns) cls.push('answered');
      if (isFlag) cls.push('flagged');
      if (i === state.currentIdx) cls.push('current');
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = cls.join(' ');
      cell.textContent = q.num;
      cell.setAttribute('aria-label', 'Question ' + q.num + (isAns ? ' (answered)' : ' (unanswered)') + (isFlag ? ' (flagged)' : ''));
      cell.addEventListener('click', function(){
        document.getElementById('navOverlay').classList.remove('active');
        goTo(i);
      });
      grid.appendChild(cell);
    });
    document.getElementById('navSummary').textContent =
      answered + ' / ' + state.questions.length + ' answered · ' + flagged + ' flagged';
  }

  /* --------------------------------------------------------
     End-of-module Review screen (dedicated, not an overlay)
     -------------------------------------------------------- */
  function goToEndReview(){
    document.body.setAttribute('data-screen', 'endreview');
    document.getElementById('screenQuestion').hidden = true;
    document.getElementById('screenEndReview').hidden = false;
    paintEndReview();
    Highlights.hidePopovers();
  }
  function leaveEndReview(){
    document.body.setAttribute('data-screen', 'question');
    document.getElementById('screenEndReview').hidden = true;
    document.getElementById('screenQuestion').hidden = false;
  }
  function paintEndReview(){
    var grid = document.getElementById('erGrid');
    grid.innerHTML = '';
    var answered = 0, flagged = 0;
    state.questions.forEach(function(q, i){
      var key = String(q.num);
      var isAns = (key in state.answers), isFlag = !!state.flags[key];
      if (isAns) answered++;
      if (isFlag) flagged++;
      var cls = ['nav-cell'];
      if (isAns) cls.push('answered');
      if (isFlag) cls.push('flagged');
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = cls.join(' ');
      cell.textContent = q.num;
      cell.setAttribute('aria-label', 'Jump to question ' + q.num);
      cell.addEventListener('click', function(){ leaveEndReview(); goTo(i); });
      grid.appendChild(cell);
    });
    var unanswered = state.questions.length - answered;
    var lang = (localStorage.getItem('tck_lang') || 'jp');
    var labels = (lang === 'en')
      ? { a: 'Answered', u: 'Unanswered', f: 'Flagged' }
      : { a: '回答済み', u: '未回答',     f: 'フラグ' };
    document.getElementById('erStats').innerHTML = ''
      + '<div class="er-stat"><div class="er-stat-num">' + answered + '</div><div class="er-stat-label">' + labels.a + '</div></div>'
      + '<div class="er-stat"><div class="er-stat-num' + (unanswered ? ' warn' : '') + '">' + unanswered + '</div><div class="er-stat-label">' + labels.u + '</div></div>'
      + '<div class="er-stat"><div class="er-stat-num">' + flagged + '</div><div class="er-stat-label">' + labels.f + '</div></div>';
    document.getElementById('erSub').textContent = (lang === 'en')
      ? 'You can\'t change answers after submitting. Jump back to any question from the grid below, or submit when you\'re ready.'
      : '提出後は回答を変更できません。気になる問題は下のグリッドから戻れます。準備ができたら「提出」へ。';
  }

  /* --------------------------------------------------------
     Submit flow
     -------------------------------------------------------- */
  function buildSubmitConfirm(){
    var unanswered = state.questions.filter(function(q){ return !(String(q.num) in state.answers); }).length;
    var flagged = Object.keys(state.flags).filter(function(k){ return state.flags[k]; }).length;
    var lang = (localStorage.getItem('tck_lang') || 'jp');
    var body = (lang === 'en')
      ? "You won't be able to change your answers after this. "
        + (unanswered ? unanswered + ' question(s) unanswered. ' : '')
        + (flagged ? flagged + ' flagged.' : '')
      : '提出後は回答を変更できません。'
        + (unanswered ? '\n未回答: ' + unanswered + ' 問' : '')
        + (flagged ? ' / フラグ: ' + flagged + ' 問' : '');
    return { body: body };
  }
  function openConfirm(opts){
    var body = document.getElementById('confirmBody');
    if (body && opts && opts.body){
      body.innerHTML = '<span style="white-space:pre-line">' + escapeHtml(opts.body) + '</span>';
    }
    openOverlay('confirmOverlay');
  }

  function autoSubmit(){
    openOverlay('timeupOverlay');
    submit({ reason: 'timeup', defer: true });
  }

  function submit(opts){
    stopTimer();
    var submittedAt = Date.now();
    var startedAt   = state.startedAt || submittedAt;
    var durationSecs = Math.round((submittedAt - startedAt) / 1000);

    var raw = 0;
    var perQuestion = state.questions.map(function(q){
      var key = String(q.num);
      var sel = (key in state.answers) ? state.answers[key] : null;
      var correct = (sel !== null && sel === q.answer_index);
      if (correct) raw++;
      return {
        num: q.num,
        domain: q.domain || '',
        skill: q.skill || '',
        convention: q.convention || null,
        difficulty: q.difficulty || '',
        selected: sel,
        correct_index: q.answer_index,
        is_correct: correct,
        flagged: !!state.flags[key],
        eliminations: Object.keys(state.eliminations[key] || {}).map(Number)
      };
    });
    var total = state.questions.length;
    var perDomain = aggregate(perQuestion, function(r){ return r.domain || '(uncategorized)'; });
    /* Per-skill rows: SEC items aggregate by their specific convention
       (possessive apostrophe, dangling modifier, …) so the breakdown
       surfaces subtypes instead of one lumped "Conventions" bar. */
    var perSkill  = aggregate(perQuestion, function(r){ return (r.domain || '') + ' / ' + (r.convention || r.skill || ''); });

    var scaled = null, scaledNote = null;
    var tbl = (window.SAT_CONFIG && SAT_CONFIG.rawToScaled && SAT_CONFIG.rawToScaled[state.testId]) || null;
    if (tbl && (raw in tbl)) scaled = tbl[raw];
    else scaledNote = 'not_configured';

    var result = {
      testId: state.testId,
      module: (state.test && state.test.module) || 1,
      title_en: (state.test && state.test.title_en) || '',
      title_jp: (state.test && state.test.title_jp) || '',
      raw: raw, total: total,
      percent: total ? Math.round((raw / total) * 100) : 0,
      scaled: scaled, scaledNote: scaledNote,
      perDomain: perDomain, perSkill: perSkill,
      perQuestion: perQuestion,
      durationSecs: durationSecs,
      autoSubmitted: opts && opts.reason === 'timeup',
      blurCount: state.blurCount,
      startedAt: startedAt, submittedAt: submittedAt
    };

    try { sessionStorage.setItem(resultsKey(), JSON.stringify(result)); } catch(e){}

    try {
      if (typeof Api !== 'undefined' && Api.saveAnswers) {
        var prefix = (window.SAT_CONFIG && SAT_CONFIG.attemptSetPrefix) || 'SAT R&W';
        Api.saveAnswers(prefix + ' · ' + state.testId, state.answers, raw, {
          attemptNumber: 1, harderCorrect: 0, harderTotal: 0
        });
      }
    } catch(e){}

    clearProgress();

    if (opts && opts.defer) return;
    location.href = state.resultsUrl;
  }

  function aggregate(perQuestion, keyFn){
    var order = [], map = {};
    perQuestion.forEach(function(r){
      var k = keyFn(r);
      if (!(k in map)) { map[k] = { correct: 0, total: 0 }; order.push(k); }
      map[k].total++;
      if (r.is_correct) map[k].correct++;
    });
    return order.map(function(k){
      var m = map[k];
      return { key: k, correct: m.correct, total: m.total, percent: m.total ? Math.round((m.correct/m.total)*100) : 0 };
    });
  }

  /* Expose rendering helpers + the boot entry so the results page
     (which loads app.js alongside results.js) can reuse them. */
  return {
    boot: boot,
    renderPassage: renderPassage,
    renderFigure: renderFigure,
    applyEmphasis: applyEmphasis,
    escapeHtml: escapeHtml,
    formatTime: formatTime
  };
})();
