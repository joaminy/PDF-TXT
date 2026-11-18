/* PDF → TXT — 문자인식(OCR)
   공개 문자인식 엔진 Tesseract(tesseract.js)를 이 기기의 브라우저 안에서 돌린다.
   엔진과 학습 데이터는 이 앱 주소에서만, 처음 한 번 받아 기기 보관함에 두고 꺼내 쓴다.
   쪽 그림은 메모리 안에서만 다루며 어디로도 보내지 않는다.
   엔진 안의 글자 인식기는 글자 모양을 학습한 작은 신경망(LSTM)이지만, 인터넷이나 AI 서비스와는 통신하지 않는다. */
(function () {
  'use strict';
  var BASE = 'vendor/tesseract/';
  var CACHE_PREFIX = 'pdf2txt-app-';
  // WebAssembly SIMD 지원 확인용 최소 모듈(wasm-feature-detect와 같은 시험)
  var SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  var DPI = 250, MAX_SIDE = 3000, MAX_AREA = 9e6;
  var PROBE_DPI = 150;   // 방향을 시험할 때는 낮은 해상도로 빠르게 읽는다

  var manifestP = null, libP = null, engines = Object.create(null), dlP = null, dlListeners = [];
  var gen = 0;   // stop()을 부를 때마다 늘어난다. 멈추기 전에 시작한 읽기는 이어서 새 작업자를 만들지 않는다.
  function stopped() { var e = new Error('문자인식을 멈췄습니다'); e.code = 'cancelled'; return e; }
  var progressCb = null;
  var autoFirst = 'kor';
  var probeHits = 0, probeFails = 0;   // 한 문서 안에서 방향 시험이 들어맞은/헛된 횟수

  function abs(p) { return new URL(p, document.baseURI).href; }
  function hasSimd() { try { return WebAssembly.validate(SIMD_TEST); } catch (e) { return false; } }
  var SIMD = hasSimd();
  function corePath() { return BASE + (SIMD ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'); }

  function manifest() {
    if (!manifestP) {
      manifestP = fetch('ocr-assets.json').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(function (e) { manifestP = null; throw e; });
    }
    return manifestP;
  }

  /** 이 기기에 필요한 파일: 기기에 맞는 엔진 하나 + 한국어·영어 학습 데이터 */
  async function neededFiles() {
    var m = await manifest();
    return m.files.filter(function (f) { return f.kind !== 'core' || f.simd === SIMD; });
  }

  async function cachedPaths() {
    var have = new Set();
    if (!('caches' in window)) return have;
    var keys = await caches.keys();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(CACHE_PREFIX) !== 0) continue;
      var c = await caches.open(keys[i]);
      (await c.keys()).forEach(function (r) { have.add(new URL(r.url).pathname); });
    }
    return have;
  }

  /** 엔진이 기기에 준비되었는지와 받아야 할 크기 */
  async function status() {
    var files = await neededFiles();
    var have = await cachedPaths();
    var total = 0, missing = 0;
    files.forEach(function (f) {
      total += f.size;
      if (!have.has(new URL(f.path, document.baseURI).pathname)) missing += f.size;
    });
    return { total: total, missing: missing, ready: missing === 0, offlineCapable: !!(navigator.serviceWorker && navigator.serviceWorker.controller) };
  }

  /** 엔진 파일을 이 앱 주소에서 받아 기기 보관함에 넣는다(서비스 워커가 내용 해시를 확인해 보관). 동시에 불러도 한 번만 받는다. */
  function download(onProgress) {
    if (onProgress) dlListeners.push(onProgress);
    if (!dlP) {
      dlP = downloadOnce(function (d, t) {
        dlListeners.forEach(function (f) { try { f(d, t); } catch (e) { /* 무시 */ } });
      }).finally(function () { dlP = null; dlListeners = []; });
    }
    return dlP;
  }
  async function downloadOnce(onProgress) {
    var files = await neededFiles();
    var have = await cachedPaths();
    var todo = files.filter(function (f) { return !have.has(new URL(f.path, document.baseURI).pathname); });
    var total = todo.reduce(function (a, f) { return a + f.size; }, 0), done = 0;
    if (onProgress) onProgress(0, total);
    for (var i = 0; i < todo.length; i++) {
      var res = await fetch(todo[i].path);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + todo[i].path);
      if (res.body && res.body.getReader) {
        var reader = res.body.getReader();
        for (;;) {
          var step = await reader.read();
          if (step.done) break;
          done += step.value.length;
          if (onProgress) onProgress(Math.min(done, total), total);
        }
      } else {
        done += (await res.arrayBuffer()).byteLength;
        if (onProgress) onProgress(Math.min(done, total), total);
      }
    }
    if (onProgress) onProgress(total, total);
  }

  function loadLib() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!libP) {
      libP = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = BASE + 'tesseract.min.js';
        s.async = true;
        s.onload = function () { if (window.Tesseract) resolve(window.Tesseract); else reject(new Error('tesseract.js')); };
        s.onerror = function () { reject(new Error('tesseract.js를 불러오지 못했습니다')); };
        document.head.appendChild(s);
      }).catch(function (e) { libP = null; throw e; });
    }
    return libP;
  }

  async function bytes(path) {
    var r = await fetch(path);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
    return new Uint8Array(await r.arrayBuffer());
  }

  /**
   * 언어 묶음(kor, kor+eng, eng)마다 작업자 하나를 만든다.
   * 엔진·학습 데이터는 화면 쪽에서 받아(기기 보관함을 거침) 작업자에게 직접 넘기므로, 작업자는 네트워크를 쓰지 않는다.
   */
  function engine(langKey) {
    if (!engines[langKey]) {
      engines[langKey] = (async function () {
        var T = await loadLib();
        var core = await bytes(corePath());
        var coreUrl = URL.createObjectURL(new Blob([core], { type: 'text/javascript' }));
        core = null;
        try {
          var langs = [];
          var codes = langKey.split('+');
          for (var i = 0; i < codes.length; i++) {
            langs.push({ code: codes[i], data: await bytes(BASE + 'lang/' + codes[i] + '.traineddata.gz') });
          }
          return await T.createWorker(langs, 1, {
            workerPath: abs(BASE + 'worker.min.js'),
            corePath: coreUrl + '#.js',         // tesseract.js는 .js로 끝나야 파일 경로로 본다
            workerBlobURL: false,
            cacheMethod: 'none',                // 기기 저장소(IndexedDB)에 따로 쓰지 않는다
            logger: function (m) {
              if (progressCb && m && m.status === 'recognizing text' && typeof m.progress === 'number') progressCb(m.progress);
            },
            errorHandler: function () { /* 결과의 오류로 처리 */ }
          });
        } finally {
          URL.revokeObjectURL(coreUrl);
        }
      })().catch(function (e) { delete engines[langKey]; throw e; });
    }
    return engines[langKey];
  }

  /** 작업자를 모두 끝낸다(진행 중인 인식도 멈춘다). 메모리를 돌려준다. */
  async function stop() {
    gen++;
    var list = Object.keys(engines).map(function (k) { return engines[k]; });
    engines = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      try { var w = await list[i]; await w.terminate(); } catch (e) { /* 무시 */ }
    }
  }

  function wordStats(data) {
    var n = 0, low = 0;
    (data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          (l.words || []).forEach(function (w) {
            if (!/[\p{L}\p{N}]/u.test(w.text || '')) return;
            n++;
            if (w.confidence < 60) low++;
          });
        });
      });
    });
    return { words: n, lowRatio: n ? low / n : 0, conf: typeof data.confidence === 'number' ? data.confidence : 0 };
  }
  function hangulShare(text) {
    var letters = (String(text).match(/\p{L}/gu) || []).length;
    var hangul = (String(text).match(/[가-힣]/g) || []).length;
    return letters ? hangul / letters : 0;
  }

  async function run(langKey, blob, g) {
    if (g !== gen) throw stopped();
    var w = await engine(langKey);
    if (g !== gen) throw stopped();
    var r = await w.recognize(blob, {}, { text: true, blocks: true });
    return r.data;
  }

  /** 문서를 새로 읽기 시작할 때: 자동 언어 고르기를 처음 상태로 */
  function resetAuto() { autoFirst = 'kor'; probeHits = probeFails = 0; }

  /**
   * 그림 한 장을 읽는다. lang: 'auto' | 'kor' | 'kor+eng' | 'eng'
   * 자동: 한국어로 먼저 읽고, 영어가 섞였거나 영어 문서로 보이면 한국어+영어로 다시 읽어 더 믿을 만한 쪽을 고른다.
   * (Tesseract는 한국어만 고르면 한글을 가장 정확히 읽고, 영어를 함께 고르면 한글을 영문자로 잘못 읽는 일이 늘어난다)
   */
  async function recognize(blob, lang, onProgress, g) {
    try {
      if (lang && lang !== 'auto') {
        progressCb = function (p) { if (onProgress) onProgress(p, 1); };
        return { data: await run(lang, blob, g), lang: lang };
      }
      var first = autoFirst;
      progressCb = function (p) { if (onProgress) onProgress(p, 1); };
      var a = await run(first, blob, g);
      var sa = wordStats(a);
      if (first === 'kor' && (sa.lowRatio > 0.03 || sa.conf < 85)) {
        progressCb = function (p) { if (onProgress) onProgress(p, 2); };
        var b = await run('kor+eng', blob, g);
        var sb = wordStats(b);
        if (sb.conf >= sa.conf + 1) {
          if (sa.conf < 60) autoFirst = 'kor+eng';   // 영어 문서로 보이면 다음 쪽부터 한국어+영어로 바로 읽는다
          return { data: b, lang: 'kor+eng' };
        }
        return { data: a, lang: 'kor' };
      }
      if (first === 'kor+eng' && hangulShare(a.text) > 0.5) autoFirst = 'kor';
      return { data: a, lang: first };
    } finally {
      progressCb = null;
    }
  }

  /**
   * PDF 한 쪽을 그려서 읽는다. onProgress(진행 0~1, 몇 번째 읽기, 더 돌린 각도)
   * 글자처럼 보이는 것은 많은데 신뢰도가 아주 낮으면 거꾸로·옆으로 스캔된 쪽일 수 있다.
   * 그때는 180°·90°·270°로 돌려 낮은 해상도·언어 하나로 빠르게 시험해 보고,
   * 분명히 나은 방향이 있으면 그 방향으로 제대로 다시 읽는다(나아지지 않으면 처음 결과를 쓴다).
   */
  async function readPage(page, pdfjsLib, lang, onProgress) {
    var g = gen;
    var auto = !lang || lang === 'auto';
    var saved = autoFirst;
    function cb(rot) { return function (p, pass) { if (onProgress) onProgress(p, pass, rot); }; }
    async function draw(rot, dpi) {
      if (g !== gen) throw stopped();
      return renderPage(page, pdfjsLib, rot, dpi);
    }
    var r = await recognize(await draw(0), lang, cb(0), g);
    var q = quality(r.data);
    // 사진만 있는 쪽이 많은 문서에서 시간을 버리지 않도록, 들어맞은 적 없이 세 쪽에서 헛되면 그 문서에서는 그만 시험한다
    if (q.conf < 50 && q.words >= 15 && (probeHits > 0 || probeFails < 3)) {
      var probe = auto ? 'kor+eng' : lang;   // 한국어·영어 어느 쪽 글이든 바로 선 방향을 알아볼 수 있다
      var best = null;
      var rots = [180, 90, 270];
      for (var i = 0; i < rots.length; i++) {
        var d = (await recognize(await draw(rots[i], PROBE_DPI), probe, cb(rots[i]), g)).data;
        var qd = quality(d);
        if (qd.conf >= 60 && qd.conf > q.conf + 10 && (!best || qd.conf > best.conf)) best = { rot: rots[i], conf: qd.conf };
        if (best && best.conf >= 80) break;
      }
      if (!best) probeFails++;
      else {
        probeHits++;
        if (auto) autoFirst = saved;    // 뒤집힌 그림으로 내린 언어 판단은 버린다
        var r2 = await recognize(await draw(best.rot), lang, cb(best.rot), g);
        var q2 = quality(r2.data);
        if (q2.conf > q.conf) { r = r2; q = q2; r.rotated = best.rot; }
      }
    }
    if (auto && q.conf < 50) autoFirst = saved;   // 믿기 어려운 쪽으로는 문서의 언어를 판단하지 않는다
    return r;
  }

  /**
   * PDF.js 쪽을 문자인식에 알맞은 해상도(약 250dpi, 최대 900만 화소)의 PNG로 그린다.
   * extraRotation: 거꾸로·옆으로 스캔된 쪽을 다시 읽을 때 더 돌릴 각도(0·90·180·270), dpi: 해상도(기본 250)
   */
  async function renderPage(page, pdfjsLib, extraRotation, dpi) {
    var rotation = ((page.rotate || 0) + (extraRotation || 0)) % 360;
    var vp1 = page.getViewport({ scale: 1, rotation: rotation });
    var scale = Math.min((dpi || DPI) / 72, MAX_SIDE / Math.max(vp1.width, vp1.height), Math.sqrt(MAX_AREA / (vp1.width * vp1.height)));
    var vp = page.getViewport({ scale: scale, rotation: rotation });
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      await page.render({
        canvasContext: ctx,
        viewport: vp,
        annotationMode: pdfjsLib.AnnotationMode.DISABLE,   // 양식 입력값은 따로 꺼내므로 그림에는 넣지 않는다
        background: '#ffffff'
      }).promise;
      return await new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('그림을 만들지 못했습니다')); }, 'image/png');
      });
    } finally {
      canvas.width = canvas.height = 1;   // 메모리 비우기
    }
  }

  /** 결과의 믿을 만한 정도: 낱말 수와 평균 신뢰도 */
  function quality(data) { var st = wordStats(data); return { words: st.words, conf: st.conf }; }

  window.Pdf2TxtOcr = {
    status: status,
    download: download,
    readPage: readPage,
    resetAuto: resetAuto,
    stop: stop,
    simd: SIMD
  };
})();
