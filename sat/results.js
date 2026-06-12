/* ============================================================
   SAT Reps Demo — Results renderer
   ============================================================
   Reads the saved result object from sessionStorage (written by
   SATPractice.submit) plus the original bank JSON (for full
   passages, rationale, and per-distractor "why"), then paints:

     • Score banner (raw / % / optional scaled)
     • Per-domain bars
     • Per-skill bars, with SEC (or any domain in
       SAT_CONFIG.explodeSkillsInDomains) expanded into subskills
     • Per-question review cards with rationale + distractor traps

   Public surface: SATResults.render({ testId, dataUrl, practiceUrl }).
   Depends on SATPractice (loaded ahead of this) for renderPassage /
   renderFigure / escapeHtml — keeps the rendering canon in one
   place rather than diverging between the live + review screens.
   ============================================================ */

var SATResults = (function(){

  function resultsKey(testId){ return 'sat_reps:' + testId + ':results'; }
  function progressKey(testId){ return 'sat_reps:' + testId + ':progress'; }

  function loadJson(url){
    return fetch(url, { cache: 'no-store' }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function render(opts){
    var result = null;
    try { result = JSON.parse(sessionStorage.getItem(resultsKey(opts.testId))); } catch(e){ result = null; }

    if (!result) {
      showEmptyState(opts);
      return;
    }

    // We need the bank for full passage / rationale / distractor data.
    loadJson(opts.dataUrl).then(function(bank){
      paint(result, bank, opts);
    }).catch(function(err){
      paintWithoutBank(result, opts);
      console.warn('Bank load failed; review without rationale:', err);
    });
  }

  function showEmptyState(opts){
    var shell = document.getElementById('resultsShell');
    if (!shell) return;
    shell.innerHTML =
      '<div class="section-card" style="text-align:center;padding:48px 28px">' +
        '<h2 style="margin-bottom:10px"><span class="jp">まだ結果がありません</span><span class="en">No results yet</span></h2>' +
        '<p class="section-sub"><span class="jp">先にモジュールを受験してください。</span><span class="en">Take the module first to see your results here.</span></p>' +
        '<div class="results-actions">' +
          '<a class="tn-btn primary" href="' + opts.practiceUrl + '"><span class="jp">演習を始める</span><span class="en">Begin module</span></a>' +
          '<a class="tn-btn" href="../menu.html"><span class="jp">メニューへ</span><span class="en">Menu</span></a>' +
        '</div>' +
      '</div>';
  }

  function paint(result, bank, opts){
    paintHeader(result, bank);
    paintScoreBanner(result);
    paintMetaStrip(result);
    paintDomainBars(result);
    paintSkillBars(result);
    paintReview(result, bank);
    wireActions(opts);
  }

  function paintWithoutBank(result, opts){
    // Bank failed to load — paint score + bars without review cards.
    paintHeader(result, null);
    paintScoreBanner(result);
    paintMetaStrip(result);
    paintDomainBars(result);
    paintSkillBars(result);
    var rl = document.getElementById('reviewList');
    if (rl) rl.innerHTML = '<p style="color:var(--ink-500);font-size:.88em">' +
      '<span class="jp">解説データの読み込みに失敗しました。スコアのみ表示しています。</span>' +
      '<span class="en">Couldn\'t load explanations. Showing your score only.</span></p>';
    wireActions(opts);
  }

  function paintHeader(result, bank){
    var lang = (localStorage.getItem('tck_lang') || 'jp');
    var el = document.getElementById('resultsTitle');
    if (!el) return;
    var title = (bank && bank['title_' + lang]) || (bank && bank.title_en)
             || result['title_' + lang] || result.title_en
             || ('Module ' + (result.module || 1) + ' · ' + result.testId);
    el.textContent = title;
  }

  function paintScoreBanner(result){
    document.getElementById('sbRaw').textContent = result.raw;
    document.getElementById('sbTotal').textContent = result.total;
    document.getElementById('sbPct').textContent = result.percent;

    var durationEl = document.getElementById('sbDuration');
    if (durationEl) {
      var mm = Math.floor((result.durationSecs || 0) / 60);
      var ss = (result.durationSecs || 0) % 60;
      var lang = (localStorage.getItem('tck_lang') || 'jp');
      var prefix = (lang === 'en') ? 'Finished in ' : '所要時間：';
      durationEl.textContent = prefix + mm + ':' + (ss < 10 ? '0' : '') + ss
        + (result.autoSubmitted ? (lang === 'en' ? ' · auto-submitted' : '（自動提出）') : '');
    }

    var block = document.getElementById('sbScaledBlock');
    var scaledEl = document.getElementById('sbScaled');
    var noteEl = document.getElementById('sbScaledNote');
    if (result.scaled != null) {
      block.classList.remove('unset');
      scaledEl.textContent = result.scaled;
      noteEl.innerHTML = '<span class="jp">SAT R&amp;W セクション（200–800）</span><span class="en">SAT R&amp;W section (200–800)</span>';
    } else {
      block.classList.add('unset');
      scaledEl.textContent = '—';
      noteEl.innerHTML = '<span class="jp">この試験では未設定（raw → scaled テーブル未登録）</span><span class="en">Not configured for this test (no raw→scaled table)</span>';
    }
  }

  function paintMetaStrip(result){
    var el = document.getElementById('metaStrip');
    if (!el) return;
    var bits = [];
    if (result.blurCount) {
      bits.push((localStorage.getItem('tck_lang') || 'jp') === 'en'
        ? ('Tab switches during the module: ' + result.blurCount)
        : ('途中で他タブに切り替えた回数：' + result.blurCount + ' 回'));
    }
    el.textContent = bits.join(' · ');
  }

  /* ------------- Per-domain bars ------------- */
  function paintDomainBars(result){
    var box = document.getElementById('domainBars');
    if (!box) return;
    var order = (window.SAT_CONFIG && SAT_CONFIG.domainOrder) || [];
    var rows = (result.perDomain || []).slice();
    rows.sort(function(a, b){
      var ai = order.indexOf(a.key); if (ai < 0) ai = 999;
      var bi = order.indexOf(b.key); if (bi < 0) bi = 999;
      return ai - bi;
    });
    box.innerHTML = rows.map(function(r){
      return barRowHtml({
        label: r.key,
        skillLabel: null,
        correct: r.correct,
        total: r.total,
        percent: r.percent
      });
    }).join('');
  }

  /* ------------- Per-skill bars (grouped by domain) ------------- */
  function paintSkillBars(result){
    var wrap = document.getElementById('skillGroups');
    if (!wrap) return;
    var explode = ((window.SAT_CONFIG && SAT_CONFIG.explodeSkillsInDomains) || []).reduce(function(m, d){ m[d] = true; return m; }, {});
    var order = (window.SAT_CONFIG && SAT_CONFIG.domainOrder) || [];

    // Group perSkill (which is keyed "Domain / Skill") under the domain.
    var byDomain = {};
    var domainOrderSeen = [];
    (result.perSkill || []).forEach(function(r){
      var parts = String(r.key).split(' / ');
      var domain = parts[0] || '(uncategorized)';
      var skill = parts.slice(1).join(' / ') || '—';
      if (!(domain in byDomain)) { byDomain[domain] = []; domainOrderSeen.push(domain); }
      byDomain[domain].push({ skill: skill, correct: r.correct, total: r.total, percent: r.percent });
    });

    // Stable ordering: canonical order first, then any extras.
    var domains = order.filter(function(d){ return d in byDomain; })
      .concat(domainOrderSeen.filter(function(d){ return order.indexOf(d) < 0; }));

    var html = '';
    domains.forEach(function(domain){
      var rows = byDomain[domain];
      html += '<div class="group-label">' + escapeHtml(domain) + '</div>';
      if (explode[domain]) {
        // explode: one bar per (Domain / Skill) row
        rows.forEach(function(r){
          html += barRowHtml({
            label: r.skill,
            skillLabel: null,
            correct: r.correct, total: r.total, percent: r.percent
          });
        });
      } else {
        // collapsed: still show per-skill rows for visibility, but the
        // canonical reading is the rolled-up domain bar above. The
        // expectation is most students glance at the domain bar and
        // skim the subskill lines for color.
        rows.forEach(function(r){
          html += barRowHtml({
            label: r.skill,
            skillLabel: null,
            correct: r.correct, total: r.total, percent: r.percent
          });
        });
      }
    });
    wrap.innerHTML = html;
  }

  function barRowHtml(row){
    var pct = row.percent;
    var fillCls = 'bar-fill ' + (pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low');
    return ''
      + '<div class="bar-row">'
      +   '<div class="bar-label">' + escapeHtml(row.label || '—')
      +     (row.skillLabel ? '<span class="bar-label-skill">' + escapeHtml(row.skillLabel) + '</span>' : '')
      +   '</div>'
      +   '<div class="bar-track"><div class="' + fillCls + '" style="width:' + pct + '%"></div></div>'
      +   '<div class="bar-value">' + row.correct + ' / ' + row.total
      +     '<span class="bar-value-pct">' + pct + '%</span></div>'
      + '</div>';
  }

  /* ------------- Per-question review cards ------------- */
  function paintReview(result, bank){
    var list = document.getElementById('reviewList');
    if (!list) return;
    var byNum = {};
    (bank.questions || []).forEach(function(q){ byNum[q.num] = q; });
    var figuresById = {};
    (bank.figures || []).forEach(function(f){ if (f && f.id) figuresById[f.id] = f; });

    var html = (result.perQuestion || []).map(function(r){
      var q = byNum[r.num];
      if (!q) return '';
      return reviewCardHtml(r, q, figuresById);
    }).join('');
    list.innerHTML = html;

    // Wire expand/collapse — clicking the header toggles open state.
    list.querySelectorAll('.review-card').forEach(function(card){
      var head = card.querySelector('.review-head');
      head.addEventListener('click', function(){
        card.classList.toggle('open');
      });
    });
  }

  function reviewCardHtml(r, q, figuresById){
    var letters = ['A','B','C','D'];
    var statusCls, statusTag;
    if (r.selected == null) {
      statusCls = 'unanswered';
      statusTag = '<span class="status-tag unanswered"><span class="jp">未回答</span><span class="en">Skipped</span></span>';
    } else if (r.is_correct) {
      statusCls = 'correct';
      statusTag = '<span class="status-tag correct"><span class="jp">正解</span><span class="en">Correct</span></span>';
    } else {
      statusCls = 'wrong';
      statusTag = '<span class="status-tag wrong"><span class="jp">誤答</span><span class="en">Wrong</span></span>';
    }
    var flagTag = r.flagged ? '<span class="status-tag flag">⚑ Flagged</span>' : '';

    /* Passage + figure block — reuses the live renderer. */
    var passageBlock = '';
    if (q.figure && figuresById[q.figure]) {
      passageBlock += '<div class="rv-figure">' + SATPractice.renderFigure(figuresById[q.figure]) + '</div>';
    }
    passageBlock += '<div class="rv-passage">' + SATPractice.renderPassage(q.passage || '') + '</div>';

    /* Choices */
    var choicesHtml = (q.choices || []).map(function(text, idx){
      var cls = ['rv-choice'];
      var marker = '';
      if (idx === q.answer_index) cls.push('correct');
      if (idx === r.selected) {
        cls.push('picked');
        if (idx !== q.answer_index) cls.push('picked-wrong');
      }
      if (idx === q.answer_index) marker = '<span class="rv-ch-marker"><span class="jp">正解</span><span class="en">Correct</span></span>';
      else if (idx === r.selected) marker = '<span class="rv-ch-marker"><span class="jp">あなたの解答</span><span class="en">Your answer</span></span>';
      return ''
        + '<div class="' + cls.join(' ') + '">'
        +   '<span class="rv-ch-letter">' + letters[idx] + '</span>'
        +   '<span class="rv-ch-text">' + escapeHtml(text) + '</span>'
        +   marker
        + '</div>';
    }).join('');

    /* Rationale */
    var rationaleHtml = '';
    if (q.rationale) {
      rationaleHtml = ''
        + '<div class="rv-rationale">'
        +   '<span class="rv-rationale-label"><span class="jp">正解の根拠</span><span class="en">Why this is correct</span></span>'
        +   applyEmphasis(q.rationale)
        + '</div>';
    }

    /* Per-distractor traps */
    var dHtml = '';
    if (q.distractors) {
      var entries = Object.keys(q.distractors)
        .map(function(k){ return { idx: parseInt(k, 10), info: q.distractors[k] }; })
        .filter(function(e){ return !isNaN(e.idx) && e.idx !== q.answer_index; })
        .sort(function(a, b){ return a.idx - b.idx; });
      if (entries.length) {
        dHtml = '<div class="rv-distractors">';
        entries.forEach(function(e){
          var trap = e.info && e.info.trap ? '<span class="trap-tag">' + escapeHtml(e.info.trap) + '</span>' : '';
          var why  = e.info && e.info.why  ? applyEmphasis(e.info.why) : '';
          dHtml += ''
            + '<div class="rv-distract">'
            +   '<div class="d-letter">' + letters[e.idx] + '</div>'
            +   '<div class="d-body">' + trap + why + '</div>'
            + '</div>';
        });
        dHtml += '</div>';
      }
    }

    return ''
      + '<div class="review-card ' + statusCls + '">'
      +   '<div class="review-head">'
      +     '<div class="review-head-left">'
      +       '<span class="review-num">Q ' + q.num + '</span>'
      +       '<div class="review-meta">'
      +         '<span class="rm-skill">' + escapeHtml(q.skill || q.domain || '—')
      +           (q.convention ? ' · ' + escapeHtml(q.convention) : '') + '</span>'
      +         '<span class="rm-domain">' + escapeHtml(q.domain || '') + '</span>'
      +       '</div>'
      +     '</div>'
      +     '<div class="review-status">'
      +       flagTag + statusTag
      +       '<button type="button" class="review-toggle"><span class="jp">展開</span><span class="en">Expand</span></button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="review-body">'
      +     passageBlock
      +     '<div class="rv-stem">' + escapeHtml(q.stem || '') + '</div>'
      +     '<div class="rv-choices">' + choicesHtml + '</div>'
      +     rationaleHtml
      +     dHtml
      +   '</div>'
      + '</div>';
  }

  function wireActions(opts){
    var btn = document.getElementById('retakeBtn');
    if (btn) {
      btn.addEventListener('click', function(){
        if (!confirm(((localStorage.getItem('tck_lang') || 'jp') === 'en')
          ? 'Clear this attempt and start over?'
          : 'この受験を消してもう一度始めますか？')) return;
        try {
          sessionStorage.removeItem(resultsKey(opts.testId));
          localStorage.removeItem(progressKey(opts.testId));
        } catch(e){}
        location.href = opts.practiceUrl;
      });
    }
  }

  /* Local fallbacks — `SATPractice.escapeHtml` exists, but defining
     small mirrors here means results.js still works if app.js fails
     to load (e.g. via the file:// scheme without a server). */
  function escapeHtml(s){
    if (typeof SATPractice !== 'undefined' && SATPractice.escapeHtml) return SATPractice.escapeHtml(s);
    return String(s).replace(/[&<>"]/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }
  function applyEmphasis(s){
    if (typeof SATPractice !== 'undefined' && SATPractice.applyEmphasis) return SATPractice.applyEmphasis(s);
    return escapeHtml(s).replace(/\*([^*\n]+)\*/g, '<em class="emph">$1</em>');
  }

  return { render: render };
})();
