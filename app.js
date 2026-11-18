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
  var DEFAULTS = { mode: 'lines', pageMarks: true, forms: true, windows: false, ocr: true, ocrLang: 'auto' };
  var OCR_LANGS = ['auto', 'kor', 'kor+eng', 'eng'];
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
  function fmtMB(n) { return (n / 1048576).toFixed(1); }
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
        ['pageMarks', 'forms', 'windows', 'ocr'].forEach(function (k) { if (v && typeof v[k] === 'boolean') s[k] = v[k]; });
        if (v && OCR_LANGS.indexOf(v.ocrLang) !== -1) s.ocrLang = v.ocrLang;
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
      wasmUrl: base + 'wasm/',      // 스캔 PDF의 JPEG 2000·JBIG2 그림 해독기(문자인식용으로 쪽을 그릴 때)
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
        if (job.pendingOcr && job.pages.length) await processOcrOnly(job);
        else await processJob(job);
      }
    } finally {
      state.running = false;
      keepAwake(false);
      if (window.Pdf2TxtOcr) window.Pdf2TxtOcr.stop();   // 문자인식 작업자가 쓰던 메모리를 돌려준다
      refreshOcrStatus();
      if (state.pendingReload) offerReload();
    }
  }

  /** 취소하면 곧바로 끝나도록, 기다리는 작업을 취소 신호와 겨룬다 */
  function armCancel(job) {
    job.cancelWait = new Promise(function (resolve, reject) { job.onCancel = function () { reject({ code: 'cancelled' }); }; });
    job.cancelWait.catch(function () { /* 처리됨 */ });
  }
  function race(job, p) { return Promise.race([p, job.cancelWait]); }

  /** PDF를 연다(암호가 있으면 묻는다). */
  async function openJobPdf(job, lib) {
    var bytes = new Uint8Array(await job.file.arrayBuffer());
    if (!C.looksLikePdf(bytes)) throw { code: 'notpdf' };
    var task = openPdf(lib, bytes);
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
    return { task: task, pdf: pdf };
  }

  async function processJob(job) {
    job.status = 'reading';
    job.phase = 'extract';
    job.pages = [];
    job.done = 0;
    job.error = job.ocrError = '';
    job.ocrStopped = false;
    job.cancel = false;
    armCancel(job);
    renderJob(job);
    var task = null;
    try {
      var lib = await loadPdfjs();
      var opened = await openJobPdf(job, lib);
      task = opened.task;
      var pdf = opened.pdf;
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
      // 글자가 없는(스캔한) 쪽은 설정에 따라 문자인식으로 읽는다. 실패해도 꺼낸 글자는 그대로 남긴다.
      if (state.settings.ocr && window.Pdf2TxtOcr) {
        var targets = [];
        job.pages.forEach(function (p, k) { if (C.needsOcr(p)) targets.push(k); });
        if (targets.length) await ocrPages(job, pdf, lib, targets, false);
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
      job.phase = '';
      if (task) { try { await task.destroy(); } catch (e) { /* 무시 */ } }
      renderJob(job);
      updateList();
    }
    if (job.status === 'done') {
      var others = state.jobs.filter(function (j) { return j.status === 'queued' || j.status === 'reading'; }).length;
      if (!others) toast(state.jobs.filter(function (j) { return j.status === 'done'; }).length > 1 ? '모든 PDF를 변환했습니다.' : '변환했습니다. ‘TXT 저장’을 눌러 파일로 받으세요.');
    }
  }

  /**
   * 정해진 쪽들을 그림으로 그려 문자인식한다.
   * all=false: 글자가 거의 없는 쪽만, 결과가 원래 글자보다 많을 때 바꾼다. all=true: 문자인식 결과로 바꾼다(깨진 글꼴 PDF용).
   * 취소하거나 엔진을 못 받으면 여기까지 읽은 결과를 남기고 알린다.
   */
  async function ocrPages(job, pdf, lib, targets, all) {
    var O = window.Pdf2TxtOcr;
    job.ocrTotal = targets.length;
    job.ocrDone = 0;
    job.ocrSub = 0;
    job.ocrPass = 1;
    try {
      var st = await O.status();
      if (!st.ready) {
        job.phase = 'ocr-download';
        job.dl = { done: 0, total: st.missing };
        renderJob(job);
        await race(job, O.download(function (d, t) { job.dl = { done: d, total: t }; showProgress(job); }));
        refreshOcrStatus();
      }
      O.resetAuto();
      job.phase = 'ocr';
      renderJob(job);
      for (var k = 0; k < targets.length; k++) {
        if (job.cancel) throw { code: 'cancelled' };
        var rec = job.pages[targets[k]];
        job.ocrSub = 0;
        job.ocrPass = 1;
        showProgress(job);
        var page = await race(job, pdf.getPage(targets[k] + 1));
        var r;
        try {
          r = await race(job, O.readPage(page, lib, state.settings.ocrLang, function (prog, pass, rot) {
            job.ocrSub = prog;
            job.ocrPass = pass;
            job.ocrRot = rot;
            showProgress(job);
          }));
        } finally {
          job.ocrRot = 0;
          try { page.cleanup(); } catch (e) { /* 무시 */ }
        }
        var lines = C.ocrLines(r.data);
        rec.ocrTried = true;
        if (all ? C.pageChars(lines) > 0 : C.preferOcr(rec.lines, lines)) {
          rec.lines = lines;
          rec.ocr = { conf: Math.round(r.data.confidence || 0), lang: r.lang, rot: r.rotated || 0 };
        }
        job.ocrDone = k + 1;
        showProgress(job);
      }
    } catch (e) {
      if (job.cancel || (e && e.code === 'cancelled')) {
        job.ocrStopped = true;
        job.cancel = false;          // 꺼낸 글자는 살린다
        O.stop();
      } else {
        job.ocrError = describeOcrError(e);
        O.stop();
      }
    }
  }

  /** 이미 변환한 결과에 문자인식만 더 한다(‘문자인식으로 읽기’ 단추). PDF를 다시 연다. */
  async function processOcrOnly(job) {
    var mode = job.pendingOcr;
    job.pendingOcr = null;
    job.status = 'reading';
    job.phase = 'open';
    job.ocrError = '';
    job.ocrStopped = false;
    job.cancel = false;
    armCancel(job);
    renderJob(job);
    var task = null;
    try {
      var lib = await loadPdfjs();
      var opened = await openJobPdf(job, lib);
      task = opened.task;
      var targets = [];
      job.pages.forEach(function (p, k) {
        if (p.err) return;
        if (mode === 'all' ? !p.ocr : C.needsOcr(p)) targets.push(k);
      });
      if (targets.length) await ocrPages(job, opened.pdf, lib, targets, mode === 'all');
    } catch (e) {
      if (job.cancel) { job.ocrStopped = true; job.cancel = false; }
      else job.ocrError = job.pwSkipped ? '암호를 입력하지 않아 문자인식을 하지 못했습니다.' : describeError(e, job);
    } finally {
      job.task = null;
      job.phase = '';
      if (task) { try { await task.destroy(); } catch (e) { /* 무시 */ } }
      job.diag = C.diagnose(job);
      job.status = 'done';
      compose(job);
      renderJob(job);
      updateList();
    }
    if (!job.ocrError && !job.ocrStopped) toast('문자인식을 마쳤습니다.');
  }

  function queueOcr(job, mode) {
    if (!job.file) return;
    job.pendingOcr = mode;
    job.status = 'queued';
    renderJob(job);
    runQueue();
  }

  function describeOcrError(e) {
    var msg = String((e && (e.message || e)) || '');
    if (/HTTP|fetch|network|Failed to fetch|Load failed|오프라인/i.test(msg) || !navigator.onLine) {
      return '문자인식 엔진을 받지 못해 글자 없는 쪽을 읽지 못했습니다. 인터넷에 연결된 상태에서 ‘문자인식으로 읽기’를 누르세요(처음 한 번만 받으면 됩니다).';
    }
    return '문자인식 중 문제가 생겨 일부 쪽을 읽지 못했습니다' + (msg ? ' (' + msg.slice(0, 100) + ')' : '') + '.';
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
      var pv = progressValue(job);
      var prog = h('progress', { max: '1', value: pv == null ? null : String(pv) });
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
    // 문자인식 단추: 글자가 없는 쪽이 남았으면 그 쪽만, 그 밖에는 모든 쪽을 다시 읽는 단추(깨진 글자 등)
    if (window.Pdf2TxtOcr && job.file) {
      var d = job.diag || {};
      var untried = (d.emptyPages || []).filter(function (n) { return job.pages[n - 1] && !job.pages[n - 1].ocrTried; });
      var ocrActs = [];
      if (untried.length) {
        ocrActs.push(h('button', { class: 'btn', type: 'button', text: (untried.length === job.numPages ? '' : '글자 없는 쪽 ') + '문자인식으로 읽기', onclick: function () { queueOcr(job, 'empty'); } }));
      }
      var notOcr = job.pages.filter(function (p) { return !p.err && !p.ocr; }).length;
      if (notOcr && (d.garbled || !untried.length)) {
        // 글자가 멀쩡한 PDF에서 누르면 정확한 글자를 추정한 글자로 바꾸게 되므로, 쓰임을 단추 이름에 밝힌다
        ocrActs.push(h('button', { class: 'btn' + (d.garbled ? '' : ' small subtle'), type: 'button', text: d.garbled ? '모든 쪽을 문자인식으로 다시 읽기' : '글자가 이상할 때만: 문자인식으로 다시 읽기', onclick: function () { queueOcr(job, 'all'); } }));
      }
      if (ocrActs.length) el.appendChild(h('div', { class: 'actions ocr-acts' }, ocrActs));
    }
  }

  function noteItems(job) {
    var d = job.diag || { emptyPages: [], errorPages: [], ocrPages: [], lowConfPages: [], garbled: false };
    var out = [];
    var empty = d.emptyPages || [];
    var tried = empty.filter(function (n) { return job.pages[n - 1] && job.pages[n - 1].ocrTried; });
    var untried = empty.filter(function (n) { return tried.indexOf(n) === -1; });
    var ocrPages = d.ocrPages || [];
    var textPages = job.numPages - empty.length - d.errorPages.length;
    if (ocrPages.length) {
      out.push(h('li', { class: 'info', text: '문자인식으로 읽은 쪽: ' + C.pageRanges(ocrPages) + '쪽 (평균 신뢰도 ' + d.ocrConf + '%). 글자를 잘못 읽었을 수 있으니 중요한 내용은 원본과 비교해 확인하세요.' }));
    }
    if ((d.rotatedPages || []).length) {
      out.push(h('li', { class: 'info', text: '거꾸로·옆으로 스캔되어 방향을 돌려 읽은 쪽: ' + C.pageRanges(d.rotatedPages) + '쪽' }));
    }
    if ((d.lowConfPages || []).length) {
      out.push(h('li', { class: 'warn', text: '신뢰도가 낮은 쪽: ' + C.pageRanges(d.lowConfPages) + '쪽 — 흐리거나 기울어졌거나 글자가 작은 그림은 결과가 부정확합니다.' }));
    }
    if (job.numPages && textPages <= 0 && !d.errorPages.length && !ocrPages.length) {
      if (tried.length) out.push(h('li', { class: 'warn', text: '문자인식으로도 글자를 찾지 못했습니다. 글자가 아주 작거나 흐리거나, 글자가 없는 그림일 수 있습니다.' }));
      else out.push(h('li', { class: 'warn', text: '꺼낼 글자가 없습니다. 스캔하거나 사진으로 만든 PDF처럼 글자가 그림으로 들어 있습니다. 아래 ‘문자인식으로 읽기’를 누르면 이 기기 안에서 그림 속 글자를 읽어 냅니다.' }));
    } else {
      if (untried.length) out.push(h('li', { class: 'warn', text: '글자가 없는 쪽: ' + C.pageRanges(untried) + '쪽 (그림이나 스캔한 쪽으로 보입니다)' }));
      if (tried.length) out.push(h('li', { class: 'info', text: '문자인식으로도 글자를 찾지 못한 쪽: ' + C.pageRanges(tried) + '쪽' }));
    }
    if (job.ocrError) out.push(h('li', { class: 'bad', text: job.ocrError }));
    if (job.ocrStopped) out.push(h('li', { class: 'info', text: '문자인식을 중간에 멈췄습니다. 읽은 쪽까지만 담겼습니다.' }));
    if (d.errorPages.length) out.push(h('li', { class: 'bad', text: '읽지 못한 쪽: ' + C.pageRanges(d.errorPages) + '쪽 (파일 일부가 손상된 것 같습니다)' }));
    if (d.garbled) out.push(h('li', { class: 'warn', text: '일부 글자가 깨졌을 수 있습니다. PDF 안의 글꼴에 문자 정보가 빠진 경우입니다. ‘모든 쪽을 문자인식으로 다시 읽기’로 그림에서 글자를 읽어 볼 수 있습니다.' }));
    if (job.noCopy) out.push(h('li', { class: 'info', text: '작성자가 이 PDF의 글자 복사를 제한해 두었습니다. 저작권과 이용 조건을 지켜 사용하세요.' }));
    return out;
  }

  function progressText(job) {
    if (job.status === 'queued') return job.pendingOcr ? '문자인식 차례를 기다리는 중' : '차례를 기다리는 중';
    if (job.phase === 'open') return '여는 중…';
    if (job.phase === 'ocr-download') return '문자인식 엔진 받는 중 ' + fmtMB(job.dl.done) + ' / ' + fmtMB(job.dl.total) + ' MB (처음 한 번만)';
    if (job.phase === 'ocr') {
      var n = Math.min(job.ocrDone + 1, job.ocrTotal) + ' / ' + job.ocrTotal + '쪽';
      if (!job.ocrDone && !job.ocrSub) return '문자인식 준비 중… (' + n + ')';
      return '문자인식 ' + n + (job.ocrRot ? ' · 방향을 바꿔 다시 읽는 중' : job.ocrPass === 2 ? ' · 영어 섞인 쪽 다시 읽는 중' : '') + ' ' + Math.round(job.ocrSub * 100) + '%';
    }
    if (!job.numPages) return '여는 중…';
    return fmtNum(job.done) + ' / ' + fmtNum(job.numPages) + '쪽 읽는 중';
  }

  function progressValue(job) {
    if (job.status === 'queued' || job.phase === 'open') return null;
    if (job.phase === 'ocr-download') return job.dl && job.dl.total ? job.dl.done / job.dl.total : null;
    if (job.phase === 'ocr') return job.ocrTotal ? Math.min(1, (job.ocrDone + job.ocrSub) / job.ocrTotal) : null;
    return job.numPages ? job.done / job.numPages : null;
  }

  var progFrame = 0;
  function showProgress(job) {
    if (progFrame) return;
    progFrame = requestAnimationFrame(function () {
      progFrame = 0;
      if (job.progEl) {
        var v = progressValue(job);
        if (v == null) job.progEl.removeAttribute('value'); else job.progEl.value = v;
      }
      if (job.labelEl) job.labelEl.textContent = progressText(job);
    });
  }

  function cancelJob(job) {
    job.cancel = true;
    if (job.status === 'queued') {
      if (job.pendingOcr) { job.pendingOcr = null; job.cancel = false; job.status = 'done'; }
      else { job.status = 'cancelled'; job.error = '변환을 취소했습니다.'; }
      renderJob(job);
      updateList();
      return;
    }
    if (job.onCancel) job.onCancel();
    if (job.task && (job.phase === 'extract' || job.phase === 'open')) { try { job.task.destroy(); } catch (e) { /* 무시 */ } }
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
    [['#optMarks', 'pageMarks'], ['#optForms', 'forms'], ['#optWin', 'windows'], ['#optOcr', 'ocr']].forEach(function (pair) {
      var box = $(pair[0]);
      box.checked = !!s[pair[1]];
      box.addEventListener('change', function () { s[pair[1]] = box.checked; settingsChanged(); });
    });
    var lang = $('#optOcrLang');
    lang.value = s.ocrLang;
    lang.addEventListener('change', function () { if (OCR_LANGS.indexOf(lang.value) !== -1) { s.ocrLang = lang.value; saveSettings(); } });
    $('#ocrGet').addEventListener('click', getOcrEngine);
  }
  function settingsChanged() {
    saveSettings();
    doneJobs().forEach(function (j) { compose(j); renderJob(j); });
  }

  /* ---------- 문자인식 엔진(미리 받기·상태) ---------- */

  var ocrDownloading = false;
  async function refreshOcrStatus() {
    var el = $('#ocrStatus'), btn = $('#ocrGet');
    if (!el || ocrDownloading) return;
    if (!window.Pdf2TxtOcr) { el.textContent = '이 브라우저에서는 문자인식을 쓸 수 없습니다.'; btn.hidden = true; return; }
    try {
      var st = await window.Pdf2TxtOcr.status();
      if (st.ready) {
        el.textContent = '문자인식 엔진: 이 기기에 준비됨 — 인터넷 없이도 쓸 수 있습니다.';
        btn.hidden = true;
      } else {
        el.textContent = '문자인식 엔진: 처음 쓸 때 약 ' + fmtMB(st.missing) + ' MB를 이 앱 주소에서 한 번 받습니다.';
        btn.hidden = false;
      }
    } catch (e) {
      el.textContent = '문자인식 엔진 상태를 확인하지 못했습니다.';
      btn.hidden = true;
    }
  }
  async function getOcrEngine() {
    var el = $('#ocrStatus'), btn = $('#ocrGet');
    if (ocrDownloading || !window.Pdf2TxtOcr) return;
    ocrDownloading = true;
    btn.disabled = true;
    try {
      await window.Pdf2TxtOcr.download(function (d, t) {
        el.textContent = '문자인식 엔진 받는 중 ' + fmtMB(d) + ' / ' + fmtMB(t) + ' MB';
      });
      toast('문자인식 엔진을 받았습니다. 이제 인터넷 없이도 쓸 수 있습니다.');
    } catch (e) {
      toast('문자인식 엔진을 받지 못했습니다. 인터넷 연결을 확인해 주세요.');
    } finally {
      ocrDownloading = false;
      btn.disabled = false;
      refreshOcrStatus();
    }
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
    refreshOcrStatus();
    document.addEventListener('visibilitychange', function () {
      if (state.running && document.visibilityState === 'visible') keepAwake(true);
    });
    // 첫 변환이 빨리 시작되도록 엔진을 미리 불러 둔다
    setTimeout(function () { loadPdfjs().catch(function () { /* 변환할 때 다시 시도 */ }); }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
