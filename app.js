/* PDF → TXT — 화면
   PDF는 이 기기의 브라우저 메모리 안에서만 읽는다. 네트워크로 보내는 코드가 없고,
   앱 페이지의 보안 정책(CSP)도 다른 주소와의 통신을 막는다. */
(function () {
  'use strict';
  var C = window.Pdf2TxtCore;
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var VENDOR = 'vendor/pdfjs/';
  var SETTINGS_KEY = 'pdf2txt.settings.v1';
  var INSTALL_KEY = 'pdf2txt.installDismissed';
  var SHARE_CACHE = 'pdf2txt-share';
  var DEFAULTS = { mode: 'lines', pageMarks: true, forms: true, windows: false };
  var PREVIEW_CHARS = 20000;

  var ICON = {
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4l4 4M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  var $ = function (s, el) { return (el || document).querySelector(s); };
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function fmtBytes(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB'; }
  function fmtNum(n) { return n.toLocaleString('ko-KR'); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- 상태 ---------- */

  var state = { settings: loadSettings(), jobs: [], running: false, seq: 0, pendingReload: false };

  function loadSettings() {
    var s = Object.assign({}, DEFAULTS);
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var v = JSON.parse(raw);
        if (v && (v.mode === 'lines' || v.mode === 'paragraphs')) s.mode = v.mode;
        ['pageMarks', 'forms', 'windows'].forEach(function (k) { if (v && typeof v[k] === 'boolean') s[k] = v[k]; });
      }
    } catch (e) { /* 저장소를 못 쓰면 기본값 */ }
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* 무시 */ }
  }

  /* ---------- 알림 ---------- */

  var toastTimer = null;
  function toast(msg, action) {
    var el = $('#toast'), btn = $('#toastAct');
    $('#toastMsg').textContent = msg;
    if (action) {
      btn.textContent = action.label;
      btn.hidden = false;
      btn.onclick = function () { el.hidden = true; action.run(); };
    } else {
      btn.hidden = true;
      btn.onclick = null;
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, action ? 9000 : 3200);
  }

  /* ---------- PDF.js ---------- */

  var pdfjsP = null;
  function loadPdfjs() {
    if (!pdfjsP) {
      pdfjsP = import('./' + VENDOR + 'pdf.min.js').then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = new URL(VENDOR + 'pdf.worker.min.js', document.baseURI).href;
        return lib;
      }).catch(function (e) { pdfjsP = null; throw { code: 'engine', cause: e }; });
    }
    return pdfjsP;
  }

  function openPdf(lib, bytes) {
    var base = new URL(VENDOR, document.baseURI).href;
    return lib.getDocument({
      data: bytes,
      cMapUrl: base + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/',
      useWorkerFetch: false,        // CMap·글꼴 파일은 화면 쪽에서 앱 보관함(서비스 워커)을 거쳐 읽는다
      disableFontFace: true,        // 화면에 그리지 않으므로 글꼴을 등록하지 않는다
      disableWorkerRendering: true,
      enableXfa: true,              // XFA 양식 PDF의 글자도 꺼낸다
      verbosity: lib.VerbosityLevel.ERRORS
    });
  }

  /* ---------- 암호 ---------- */

  function askPassword(name, wrong) {
    return new Promise(function (resolve) {
      var modal = $('#pwModal'), form = $('#pwForm'), input = $('#pwInput'), cancel = $('#pwCancel');
      $('#pwMsg').textContent = wrong
        ? '암호가 맞지 않습니다. 다시 입력해 주세요. (' + name + ')'
        : '「' + name + '」에 암호가 걸려 있습니다. 암호를 입력하면 이 기기 안에서 열어 글자를 꺼냅니다. 암호는 저장하지 않습니다.';
      input.value = '';
      modal.hidden = false;
      setTimeout(function () { input.focus(); }, 30);
      function finish(v) {
        modal.hidden = true;
        form.onsubmit = null;
        cancel.onclick = null;
        document.removeEventListener('keydown', onKey);
        resolve(v);
      }
      function onKey(e) { if (e.key === 'Escape') finish(null); }
      form.onsubmit = function (e) { e.preventDefault(); finish(input.value); };
      cancel.onclick = function () { finish(null); };
      document.addEventListener('keydown', onKey);
    });
  }

  /* ---------- 화면 켜 두기(긴 변환 중 잠들지 않게) ---------- */

  var wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', function () { wakeLock = null; });
      } else if (!on && wakeLock) {
        var w = wakeLock;
        wakeLock = null;
        await w.release();
      }
    } catch (e) { wakeLock = null; }
  }

  /* ---------- 변환 ---------- */

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) { return f && typeof f.arrayBuffer === 'function'; });
    if (!files.length) return;
    files.forEach(function (f) {
      var job = {
        id: ++state.seq, file: f, name: f.name || '이름 없는 파일.pdf', size: f.size || 0,
        status: 'queued', pages: [], numPages: 0, done: 0, diag: null, noCopy: false,
        cancel: false, text: '', chars: 0, error: '', el: null, task: null
      };
      state.jobs.push(job);
      renderJob(job);
    });
    updateList();
    // 휴대폰처럼 화면이 좁으면 결과 칸으로 내려 보여 준다
    if (window.innerWidth < 900) {
      var head = $('#h-out');
      var r = head.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.6 || r.top < 0) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    runQueue();
  }

  async function runQueue() {
    if (state.running) return;
    state.running = true;
    keepAwake(true);
    try {
      var job;
      while ((job = state.jobs.find(function (j) { return j.status === 'queued'; }))) {
        await processJob(job);
      }
    } finally {
      state.running = false;
      keepAwake(false);
      if (state.pendingReload) offerReload();
    }
  }

  async function processJob(job) {
    job.status = 'reading';
    job.pages = [];
    job.done = 0;
    job.error = '';
    job.cancel = false;
    renderJob(job);
    var task = null;
    try {
      var lib = await loadPdfjs();
      var bytes = new Uint8Array(await job.file.arrayBuffer());
      if (!C.looksLikePdf(bytes)) throw { code: 'notpdf' };
      task = openPdf(lib, bytes);
      bytes = null;
      job.task = task;
      task.onPassword = function (update, reason) {
        askPassword(job.name, reason === lib.PasswordResponses.INCORRECT_PASSWORD).then(function (pw) {
          if (pw === null || job.cancel) {
            job.pwSkipped = true;
            task.destroy();
          } else update(pw);
        });
      };
      var pdf = await task.promise;
      job.pwSkipped = false;
      job.numPages = pdf.numPages;
      try {
        var perms = await pdf.getPermissions();
        var COPY = lib.PermissionFlag.COPY;
        job.noCopy = !!perms && (typeof perms.has === 'function' ? !perms.has(COPY) : perms.indexOf(COPY) === -1);
      } catch (e) { job.noCopy = false; }
      renderJob(job);
      for (var i = 1; i <= pdf.numPages; i++) {
        if (job.cancel) throw { code: 'cancelled' };
        var rec = { lines: [], annots: [], err: false };
        try {
          var page = await pdf.getPage(i);
          try { rec.lines = C.preparePage(await page.getTextContent()); } catch (e) { rec.err = true; }
          try { rec.annots = C.annotationTexts(await page.getAnnotations({ intent: 'display' })); } catch (e) { rec.annots = []; }
          try { page.cleanup(); } catch (e) { /* 무시 */ }
        } catch (e) { rec.err = true; }
        job.pages.push(rec);
        job.done = i;
        showProgress(job);
      }
      job.diag = C.diagnose(job);
      job.status = 'done';
      compose(job);
    } catch (e) {
      if (job.cancel || (e && e.code === 'cancelled')) { job.status = 'cancelled'; job.error = '변환을 취소했습니다.'; }
      else { job.status = 'error'; job.error = describeError(e, job); }
      job.pages = [];
      job.text = '';
    } finally {
      job.task = null;
      if (task) { try { await task.destroy(); } catch (e) { /* 무시 */ } }
      renderJob(job);
      updateList();
    }
    if (job.status === 'done') {
      var others = state.jobs.filter(function (j) { return j.status === 'queued' || j.status === 'reading'; }).length;
      if (!others) toast(state.jobs.filter(function (j) { return j.status === 'done'; }).length > 1 ? '모든 PDF를 변환했습니다.' : '변환했습니다. ‘TXT 저장’을 눌러 파일로 받으세요.');
    }
  }

  function describeError(e, job) {
    if (job.pwSkipped) return '암호를 입력하지 않아 건너뛰었습니다. ‘다시 시도’를 누르면 암호를 다시 묻습니다.';
    if (e && e.code === 'notpdf') return 'PDF 파일이 아닙니다. 이름만 .pdf인 다른 형식의 파일일 수 있습니다.';
    if (e && e.code === 'engine') {
      if (location.protocol === 'file:') return '파일을 직접 열어서는 변환 엔진이 작동하지 않습니다. GitHub Pages 같은 웹 주소(https://…)로 열어 주세요.';
      if (e.cause && e.cause.name === 'SyntaxError') return '이 브라우저 버전에서는 변환 엔진이 작동하지 않습니다. iPhone·iPad는 iOS 16.4 이상, Android는 최신 Chrome이나 삼성 인터넷으로 열어 주세요.';
      return '변환 엔진을 불러오지 못했습니다. 인터넷에 연결된 상태에서 앱을 한 번 다시 열면, 그다음부터는 인터넷 없이도 작동합니다.';
    }
    var name = e && e.name;
    if (name === 'InvalidPDFException') return 'PDF가 손상되었거나 읽을 수 없는 형식입니다.';
    if (name === 'PasswordException') return '암호가 맞지 않아 열지 못했습니다.';
    if (e && /NotReadableError|NotFoundError/.test(String(e.name))) return '파일을 읽지 못했습니다. 파일을 다시 골라 주세요.';
    return '이 PDF를 읽지 못했습니다' + (e && e.message ? ' (' + String(e.message).slice(0, 120) + ')' : '') + '.';
  }

  /** 설정에 맞춰 텍스트를 다시 만든다(PDF를 다시 읽지 않음). */
  function compose(job) {
    job.text = C.docText(job, state.settings);
    job.chars = C.countChars(job.text);
  }

  function jobBytes(job) { return C.encodeTxt(job.text, state.settings.windows); }
  function jobFile(job) { return new File([jobBytes(job)], C.txtName(job.name), { type: 'text/plain' }); }

  /* ---------- 파일 건네기 ---------- */

  function canShareFiles(files) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: files })); } catch (e) { return false; }
  }
  var CAN_SHARE = canShareFiles([new File(['x'], 'x.txt', { type: 'text/plain' })]);

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  /** 공유 시트를 연다. 클릭 처리 안에서 기다림 없이 바로 불러야 한다. */
  function share(files) {
    return navigator.share({ files: files }).then(function () { return true; }, function (e) {
      if (!e || e.name !== 'AbortError') toast('공유 창을 열지 못했습니다. ‘TXT 저장’을 써 주세요.');
      return false;
    });
  }
  /** iPhone·iPad에서는 공유 시트(‘파일에 저장’ 포함)로, 그 밖에서는 내려받기로 건넨다. */
  function deliver(file) {
    if (IS_IOS && canShareFiles([file])) return share([file]);
    download(file.name, file);
    toast('‘' + file.name + '’을 내려받았습니다.');
    return Promise.resolve(true);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      var ta = h('textarea', { readonly: true, class: 'sr-only' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ---------- 결과 카드 ---------- */

  function renderJob(job) {
    var list = $('#jobList');
    if (!job.el) {
      job.el = h('li', { class: 'job' });
      list.appendChild(job.el);
    }
    var el = job.el;
    el.className = 'job' + (job.status === 'error' ? ' error' : '');
    el.textContent = '';

    var title = job.status === 'done' ? C.txtName(job.name) : job.name;
    var meta = [];
    if (job.status === 'done') {
      meta.push(job.name);
      meta.push(fmtNum(job.numPages) + '쪽');
      meta.push('글자 ' + fmtNum(job.chars) + '자');
      meta.push(fmtBytes(jobBytes(job).length));
    } else {
      meta.push(fmtBytes(job.size));
      if (job.numPages) meta.push(fmtNum(job.numPages) + '쪽');
    }
    var head = h('div', { class: 'job-head' }, [
      h('div', { class: 'job-title' }, [h('b', { text: title }), h('span', { class: 'meta', text: meta.join(' · ') })]),
      job.status === 'reading' ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': '이 결과 지우기', html: ICON.x, onclick: function () { removeJob(job); } })
    ]);
    el.appendChild(head);

    if (job.status === 'queued' || job.status === 'reading') {
      var prog = h('progress', { max: '1', value: job.numPages ? String(job.done / job.numPages) : null });
      var label = h('span', { text: progressText(job) });
      el.appendChild(h('div', { class: 'prog' }, [
        prog, label,
        h('button', { class: 'btn small', type: 'button', text: '취소', onclick: function () { cancelJob(job); } })
      ]));
      job.progEl = prog;
      job.labelEl = label;
      if (job.numPages > 150 && !('wakeLock' in navigator)) {
        el.appendChild(h('ul', { class: 'notes' }, [h('li', { class: 'info', text: '쪽이 많아 시간이 걸립니다. 끝날 때까지 화면을 켠 채로 이 앱을 열어 두세요.' })]));
      }
      return;
    }
    job.progEl = job.labelEl = null;

    if (job.status === 'error' || job.status === 'cancelled') {
      el.appendChild(h('ul', { class: 'notes' }, [h('li', { class: job.status === 'error' ? 'bad' : 'info', text: job.error })]));
      if (job.file) {
        el.appendChild(h('div', { class: 'actions' }, [
          h('button', { class: 'btn', type: 'button', text: '다시 시도', onclick: function () { job.status = 'queued'; renderJob(job); runQueue(); } })
        ]));
      }
      return;
    }

    // 완료
    var notes = noteItems(job);
    if (notes.length) el.appendChild(h('ul', { class: 'notes' }, notes));
    if (job.chars > 0) {
      var shown = job.text.length > PREVIEW_CHARS ? job.text.slice(0, PREVIEW_CHARS) : job.text;
      var det = h('details', { class: 'preview' }, [
        h('summary', { text: '내용 미리보기' }),
        h('pre', { text: shown }),
        job.text.length > PREVIEW_CHARS ? h('p', { class: 'more', text: '앞부분 ' + fmtNum(PREVIEW_CHARS) + '자만 보여 줍니다. 저장하면 전체가 담깁니다.' }) : null
      ]);
      if (state.jobs.filter(function (j) { return j.status === 'done'; }).length <= 1) det.open = true;
      el.appendChild(det);
    }
    var acts = [
      h('button', { class: 'btn primary', type: 'button', html: ICON.save + '<span>TXT 저장</span>', onclick: function () { deliver(jobFile(job)); } }),
      h('button', { class: 'btn', type: 'button', html: ICON.copy + '<span>복사</span>', disabled: job.chars ? null : true, onclick: function () {
        copyText(job.text).then(function (ok) { toast(ok ? '글자를 모두 복사했습니다.' : '복사하지 못했습니다. ‘TXT 저장’을 써 주세요.'); });
      } })
    ];
    if (CAN_SHARE && !IS_IOS) {
      acts.push(h('button', { class: 'btn', type: 'button', html: ICON.share + '<span>공유</span>', onclick: function () { share([jobFile(job)]); } }));
    }
    el.appendChild(h('div', { class: 'actions' }, acts));
  }

  function noteItems(job) {
    var d = job.diag || { emptyPages: [], errorPages: [], garbled: false };
    var out = [];
    var textPages = job.numPages - d.emptyPages.length - d.errorPages.length;
    if (job.numPages && textPages <= 0 && !d.errorPages.length) {
      out.push(h('li', { class: 'warn', text: '꺼낼 글자가 없습니다. 스캔하거나 사진으로 만든 PDF처럼 글자가 그림으로 들어 있는 것으로 보입니다. 이런 PDF는 문자인식(OCR)을 거쳐야 글자를 얻을 수 있습니다.' }));
    } else if (d.emptyPages.length) {
      out.push(h('li', { class: 'warn', text: '글자가 없는 쪽: ' + C.pageRanges(d.emptyPages) + '쪽 (그림이나 스캔한 쪽으로 보입니다)' }));
    }
    if (d.errorPages.length) out.push(h('li', { class: 'bad', text: '읽지 못한 쪽: ' + C.pageRanges(d.errorPages) + '쪽 (파일 일부가 손상된 것 같습니다)' }));
    if (d.garbled) out.push(h('li', { class: 'warn', text: '일부 글자가 깨졌을 수 있습니다. PDF 안의 글꼴에 문자 정보가 빠진 경우로, 원본과 비교해 확인하세요.' }));
    if (job.noCopy) out.push(h('li', { class: 'info', text: '작성자가 이 PDF의 글자 복사를 제한해 두었습니다. 저작권과 이용 조건을 지켜 사용하세요.' }));
    return out;
  }

  function progressText(job) {
    if (job.status === 'queued') return '차례를 기다리는 중';
    if (!job.numPages) return '여는 중…';
    return fmtNum(job.done) + ' / ' + fmtNum(job.numPages) + '쪽 읽는 중';
  }

  var progFrame = 0;
  function showProgress(job) {
    if (progFrame) return;
    progFrame = requestAnimationFrame(function () {
      progFrame = 0;
      if (job.progEl) job.progEl.value = job.numPages ? job.done / job.numPages : 0;
      if (job.labelEl) job.labelEl.textContent = progressText(job);
    });
  }

  function cancelJob(job) {
    job.cancel = true;
    if (job.status === 'queued') { job.status = 'cancelled'; job.error = '변환을 취소했습니다.'; renderJob(job); updateList(); }
    else if (job.task) { try { job.task.destroy(); } catch (e) { /* 무시 */ } }
  }

  function removeJob(job) {
    cancelJob(job);
    if (job.el) job.el.remove();
    state.jobs = state.jobs.filter(function (j) { return j !== job; });
    job.pages = [];
    job.text = '';
    job.file = null;
    updateList();
  }

  function updateList() {
    var done = state.jobs.filter(function (j) { return j.status === 'done'; });
    $('#emptyMsg').hidden = state.jobs.length > 0;
    $('#bulk').hidden = done.length < 2 && state.jobs.length < 2;
    $('#zipAll').disabled = done.length < 2;
    $('#joinAll').disabled = done.length < 2;
  }

  function doneJobs() { return state.jobs.filter(function (j) { return j.status === 'done'; }); }

  function saveZip() {
    var jobs = doneJobs();
    if (!jobs.length) return;
    var names = C.uniqueNames(jobs.map(function (j) { return C.txtName(j.name); }));
    var parts = C.makeZip(jobs.map(function (j, i) { return { name: names[i], data: jobBytes(j) }; }));
    deliver(new File(parts, 'PDF-TXT-' + today() + '.zip', { type: 'application/zip' }));
  }

  function saveJoined() {
    var jobs = doneJobs();
    if (!jobs.length) return;
    var text = jobs.map(function (j) { return '##### ' + j.name + ' #####\n\n' + j.text; }).join('\n\n');
    var file = new File([C.encodeTxt(text, state.settings.windows)], '합친 텍스트 ' + jobs.length + '개 ' + today() + '.txt', { type: 'text/plain' });
    deliver(file);
  }

  /* ---------- 설정 ---------- */

  function bindSettings() {
    var s = state.settings;
    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
      r.checked = r.value === s.mode;
      r.addEventListener('change', function () { if (r.checked) { s.mode = r.value; settingsChanged(); } });
    });
    [['#optMarks', 'pageMarks'], ['#optForms', 'forms'], ['#optWin', 'windows']].forEach(function (pair) {
      var box = $(pair[0]);
      box.checked = !!s[pair[1]];
      box.addEventListener('change', function () { s[pair[1]] = box.checked; settingsChanged(); });
    });
  }
  function settingsChanged() {
    saveSettings();
    doneJobs().forEach(function (j) { compose(j); renderJob(j); });
  }

  /* ---------- 넣기 ---------- */

  function bindInput() {
    var input = $('#fileInput');
    input.addEventListener('change', function () {
      addFiles(input.files);
      input.value = '';
    });
    var zone = $('#dropZone');
    ['dragenter', 'dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      zone.addEventListener(t, function () { zone.classList.remove('over'); });
    });
    // 화면 어디에 떨어뜨려도 받는다(브라우저가 PDF를 새로 열지 않게)
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    $('#zipAll').addEventListener('click', saveZip);
    $('#joinAll').addEventListener('click', saveJoined);
    $('#clearAll').addEventListener('click', function () {
      state.jobs.slice().forEach(removeJob);
    });
  }

  /* ---------- 휴대폰 앱(PWA) ---------- */

  function setAppStatus(text) { $('#appStatus').textContent = text; }

  function offerReload() {
    var busy = state.running || state.jobs.length > 0;
    if (!busy) { location.reload(); return; }
    setAppStatus('새 버전이 준비되었습니다');
    toast('새 버전이 준비되었습니다. 지금 적용하면 화면의 결과는 지워집니다.', { label: '지금 적용', run: function () { location.reload(); } });
  }

  async function intakeShared() {
    // 다른 앱에서 ‘공유 → PDF→TXT’로 보낸 PDF를 기기 안의 임시 보관함에서 꺼내고 바로 지운다
    if (location.search) history.replaceState(null, '', location.pathname);
    if (!('caches' in window)) return;
    try {
      if (!(await caches.has(SHARE_CACHE))) return;
      var c = await caches.open(SHARE_CACHE);
      var keys = await c.keys();
      var files = [];
      for (var i = 0; i < keys.length; i++) {
        var res = await c.match(keys[i]);
        if (res) {
          var blob = await res.blob();
          var name = decodeURIComponent(res.headers.get('x-name') || 'shared.pdf');
          files.push(new File([blob], name, { type: 'application/pdf' }));
        }
        await c.delete(keys[i]);
      }
      await caches.delete(SHARE_CACHE);
      if (files.length) {
        toast('공유받은 PDF ' + files.length + '개를 변환합니다.');
        addFiles(files);
      }
    } catch (e) { /* 공유받은 파일이 없으면 넘어간다 */ }
  }

  function setupPwa() {
    var buildMeta = document.querySelector('meta[name="app-build"]');
    var build = buildMeta ? buildMeta.getAttribute('content') : '';
    var ver = build ? ' · 버전 ' + build : '';
    if (location.protocol === 'file:') {
      setAppStatus('파일로 직접 열면 작동하지 않습니다. 웹 주소(https://…)로 여세요.');
    } else if ('serviceWorker' in navigator && window.isSecureContext) {
      var hadController = !!navigator.serviceWorker.controller;
      setAppStatus((hadController ? '인터넷 없이도 작동합니다' : '오프라인용 파일을 받는 중…') + ver);
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        reg.update().catch(function () { /* 오프라인 */ });
        reg.addEventListener('updatefound', function () {
          if (!navigator.serviceWorker.controller) return;
          setAppStatus('새 버전을 받는 중…' + ver);
          var w = reg.installing;
          if (w) w.addEventListener('statechange', function () {
            if (w.state === 'redundant') setAppStatus('인터넷 없이도 작동합니다' + ver);
          });
        });
        return navigator.serviceWorker.ready;
      }).then(function () {
        setAppStatus('인터넷 없이도 작동합니다' + ver);
      }).catch(function () {
        setAppStatus('이 주소에서는 오프라인 사용을 준비하지 못했습니다' + ver);
      });
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController) { hadController = true; return; }
        if (state.running) state.pendingReload = true;
        else offerReload();
      });
    } else {
      setAppStatus('이 브라우저(또는 주소)에서는 오프라인 사용을 지원하지 않습니다' + ver);
    }

    var bar = $('#installBar');
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    var dismissed = false;
    try { dismissed = localStorage.getItem(INSTALL_KEY) === '1'; } catch (e) { dismissed = false; }
    var hint = $('#installHint');
    var btn = $('#installBtn');
    var deferred = null;
    if (!standalone && !dismissed) {
      var mobile = IS_IOS || /Android/i.test(navigator.userAgent);
      if (IS_IOS) hint.textContent = 'Safari 아래쪽(또는 주소창 옆) 공유 버튼 □↑ → “홈 화면에 추가”를 고르세요.';
      else if (mobile) hint.textContent = '브라우저 메뉴(⋮ 또는 ≡)에서 “홈 화면에 추가” 또는 “앱 설치”를 고르세요.';
      else hint.textContent = '휴대폰 브라우저로 이 주소를 열면 홈 화면에 앱으로 설치할 수 있습니다.';
      bar.hidden = false;
    }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      if (standalone) return;
      btn.hidden = false;
      hint.textContent = '“앱 설치”를 누르면 홈 화면에 아이콘이 생깁니다.';
      bar.hidden = false;
    });
    btn.addEventListener('click', async function () {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* 무시 */ }
      deferred = null;
      btn.hidden = true;
    });
    window.addEventListener('appinstalled', function () {
      bar.hidden = true;
      toast('홈 화면에 설치했습니다. 이제 아이콘으로 여세요.');
    });
    $('#installClose').addEventListener('click', function () {
      bar.hidden = true;
      try { localStorage.setItem(INSTALL_KEY, '1'); } catch (e) { /* 무시 */ }
    });
    intakeShared();
  }

  /* ---------- 시작 ---------- */

  function start() {
    bindSettings();
    bindInput();
    updateList();
    setupPwa();
    document.addEventListener('visibilitychange', function () {
      if (state.running && document.visibilityState === 'visible') keepAwake(true);
    });
    // 첫 변환이 빨리 시작되도록 엔진을 미리 불러 둔다
    setTimeout(function () { loadPdfjs().catch(function () { /* 변환할 때 다시 시도 */ }); }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
