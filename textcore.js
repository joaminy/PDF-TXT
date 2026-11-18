/* PDF → TXT — 글자 정리 핵심 (화면·네트워크·저장소를 쓰지 않는 순수 함수)
   PDF.js가 PDF에서 꺼낸 글자 조각(textContent.items)을 줄로 묶고,
   쪽·파일 단위의 텍스트로 정리한다. AI·문자인식(OCR)은 쓰지 않는다. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pdf2TxtCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NONSPACE = /\S/;
  var HANGUL = /[가-힣]/;
  // 띄어쓰기 없이 이어 쓰는 글자(한자·가나·전각 기호). 한글은 띄어 쓰므로 넣지 않는다.
  var CJK_NOSPACE = /[⺀-⿿　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿＀-｠￠-￦]/;
  // 전각(한 글자 폭이 글자 크기와 비슷한) 글자 — 낱말 폭을 어림할 때 쓴다
  var WIDE = /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
  var CLOSE_PUNCT = /^[)\]}>.,!?;:%、。，．！？；：」』】〉》’”]/;
  var OPEN_PUNCT = /[(\[{<「『【〈《‘“]$/;
  var LIST_MARK = new RegExp('^(?:' + [
    '[•·∙◦▪▫■□●○◆◇▶▷►‣※★☆✓✔➢➤]',
    '[-–—*+](?=\\s)',
    '\\(?\\d{1,3}[.)](?=\\s)',
    '\\(\\d{1,3}\\)',
    '\\(?[a-zA-Z][.)](?=\\s)',
    '\\([가-힣ㄱ-ㅎ]\\)',
    '[가-힣ㄱ-ㅎ][.)](?=\\s)',
    '[①-⑳⑴-⒇㉠-㉭㉮-㉻]',
    '(?:[IVX]{1,4}|[ivx]{1,4})[.)](?=\\s)'
  ].join('|') + ')');
  var HYPHEN_END = /\p{L}[-\u2010]$/u;
  var LOWER_START = /^\p{Ll}/u;
  var LINE_SEP = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  var TAB_SURE = 2.5;    // 글자 크기의 이 배수보다 크게 떨어진 글자는 표의 다른 칸으로 본다
  var TAB_MAYBE = 1.5;   // 이만큼 떨어졌고 위아래 줄과 칸 위치가 맞으면 표의 칸으로 본다
  var GAP_MARK = '\u0001';

  function charWeight(ch) {
    if (ch === ' ' || ch === '\t') return 0.3;
    return WIDE.test(ch) ? 1 : 0.55;
  }
  function strWeight(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += charWeight(s[i]);
    return w;
  }
  function sortedCopy(arr) { return arr.slice().sort(function (a, b) { return a - b; }); }
  function percentile(arr, p) {
    if (!arr.length) return NaN;
    var a = sortedCopy(arr);
    return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  }

  /* ---------- 1. 글자 조각 → 줄 ---------- */

  /**
   * PDF.js의 글자 조각을 줄 단위로 묶는다. PDF.js가 줄이 바뀌었다고 표시한 곳(hasEOL)에서 끊는다.
   * 줄마다 글자, 방향, 시작·끝 위치, 기준선, 글자 크기를 담는다.
   */
  function buildLines(items, styles) {
    var lines = [];
    var cur = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string') continue;   // 구조 표식(marked content) 등
      if (!it.transform) {                               // XFA 양식: 위치 정보 없이 글자만 온다
        if (cur.length) { pushLine(lines, cur, styles); cur = []; }
        if (NONSPACE.test(it.str)) lines.push(plainLine(it.str));
        continue;
      }
      if (it.str) cur.push(it);
      if (it.hasEOL) { pushLine(lines, cur, styles); cur = []; }
    }
    pushLine(lines, cur, styles);
    return lines;
  }

  function plainLine(str) {
    return { text: str.replace(/\s+/g, ' ').trim(), ok: false, x0: 0, x1: 0, v: 0, size: 0, tab: false, rtl: false, firstW: 0, dir: 0, starts: [], ends: [], cands: [] };
  }

  function pushLine(lines, items, styles) {
    var line = makeLine(items, styles);
    if (line) lines.push(line);
  }

  function makeLine(items, styles) {
    var first = null, i;
    for (i = 0; i < items.length; i++) {
      if (NONSPACE.test(items[i].str)) { first = items[i]; break; }
    }
    if (!first) return null;
    var t = first.transform;
    var sc = Math.hypot(t[0], t[1]);
    var cos = sc > 0 ? t[0] / sc : 1;
    var sin = sc > 0 ? t[1] / sc : 0;
    var line = {
      text: '', ok: true, x0: Infinity, x1: -Infinity, v: 0, size: 0,
      tab: false, rtl: first.dir === 'rtl', firstW: 0,
      dir: Math.round(Math.atan2(sin, cos) * 180 / Math.PI),
      starts: [], ends: [], cands: []
    };
    var out = '';
    var pendingSpace = false;
    var prevEnd = null;
    var bestLen = -1;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var str = it.str;
      if (!NONSPACE.test(str)) { pendingSpace = true; continue; }
      var tt = it.transform || t;
      var s2 = Math.hypot(tt[0], tt[1]);
      if (s2 > 0 && (Math.abs(tt[0] / s2 - cos) > 0.03 || Math.abs(tt[1] / s2 - sin) > 0.03)) line.ok = false; // 방향이 다른 글자가 섞임
      if (it.dir === 'ttb' || (styles && styles[it.fontName] && styles[it.fontName].vertical)) line.ok = false; // 세로쓰기
      var u = tt[4] * cos + tt[5] * sin;          // 글자 진행 방향 위치
      var w = Math.abs(it.width || 0);
      var size = Math.abs(it.height || s2 || 0);
      if (prevEnd !== null) {
        var gap = (u - prevEnd) / (Math.max(size, line.size) || 10);
        if (gap > TAB_MAYBE) {
          out = out.replace(/[ \t]+$/, '');
          str = str.replace(/^\s+/, '');
          pendingSpace = false;
          if (gap > TAB_SURE) { out += '\t'; line.tab = true; }
          else { out += GAP_MARK; line.cands.push({ u: u, e: u + w }); }  // 칸인지 띄어쓰기인지 쪽 단위로 나중에 판단
        }
      }
      if (pendingSpace && out && !/\s$/.test(out) && !/^\s/.test(str)) out += ' ';
      pendingSpace = false;
      out += str;
      if (u < line.x0) line.x0 = u;
      if (u + w > line.x1) line.x1 = u + w;
      line.starts.push(u);
      line.ends.push(u + w);
      prevEnd = prevEnd === null ? u + w : Math.max(prevEnd, u + w);
      var len = str.replace(/\s+/g, '').length;
      if (len > bestLen) {
        bestLen = len;
        line.size = size;
        line.v = -tt[4] * sin + tt[5] * cos;      // 기준선 높이(위쪽이 큼)
      }
    }
    line.text = out.trim();
    if (!(line.size > 0)) line.ok = false;
    // 다음 줄 첫 낱말이 이 줄 끝에 들어갈 수 있었는지 판단하려고, 첫 낱말의 폭을 어림해 둔다
    var fs = first.str.replace(/^\s+/, '');
    var m = /^\S+/.exec(fs);
    var word = m ? m[0] : fs;
    if (CJK_NOSPACE.test(word.charAt(0))) word = word.charAt(0);
    line.firstW = Math.abs(first.width || 0) * (strWeight(word) / (strWeight(first.str) || 1));
    return line;
  }

  /* ---------- 2. 줄 → 표 칸·문단 경계 ---------- */

  function usable(L, mainDir) {
    return L.ok && !L.rtl && L.dir === mainDir;
  }

  /** 크게 떨어진 글자(후보)가 위아래 줄의 글자 시작·끝 위치와 맞으면 표의 칸(탭)으로, 아니면 띄어쓰기로 정한다. */
  function resolveGaps(lines, mainDir) {
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L.cands.length) continue;
      var tol = Math.max(1.5, 0.15 * L.size);
      var marks = L.cands.map(function (c) {
        for (var k = i - 2; k <= i + 2; k++) {
          if (k === i || k < 0 || k >= lines.length) continue;
          var M = lines[k];
          if (!usable(M, mainDir) || M.dir !== L.dir) continue;
          for (var j = 0; j < M.starts.length; j++) {
            if (Math.abs(M.starts[j] - c.u) <= tol || Math.abs(M.ends[j] - c.e) <= tol) return '\t';
          }
        }
        return ' ';
      });
      var idx = 0;
      L.text = L.text.replace(/\u0001/g, function () { return marks[idx++] || ' '; });
      if (marks.indexOf('\t') !== -1) L.tab = true;
    }
  }

  /** 두 줄 사이가 문단 간격(빈 줄)만큼 떨어졌는지의 기준 */
  function gapLimit(A, B, pitch) {
    var s = Math.min(A.size, B.size);
    return pitch ? s * Math.max(1.3 * pitch, pitch + 0.3) : 2 * s;
  }

  /** 쪽 안의 대표 글자 방향, 줄 간격, 줄마다 속한 글 덩어리의 오른쪽 끝(R)을 계산한다. */
  function analyze(lines) {
    var n = lines.length, i, j;
    var count = {}, mainDir = 0, best = -1;
    for (i = 0; i < n; i++) {
      if (!lines[i].ok) continue;
      count[lines[i].dir] = (count[lines[i].dir] || 0) + lines[i].text.length;
    }
    Object.keys(count).forEach(function (k) { if (count[k] > best) { best = count[k]; mainDir = +k; } });
    resolveGaps(lines, mainDir);

    // 줄 간격: 이웃한 두 줄 기준선 거리를 글자 크기에 대한 비율로 모아 가운데 값을 쓴다
    var ratios = [];
    for (i = 0; i + 1 < n; i++) {
      var A = lines[i], B = lines[i + 1];
      if (!usable(A, mainDir) || !usable(B, mainDir)) continue;
      var r = B.size / A.size;
      if (r < 0.8 || r > 1.25) continue;
      var d = A.v - B.v;
      if (d > 0.5 * A.size && d < 3 * A.size) ratios.push(d / A.size);
    }
    var pitch = ratios.length >= 2 ? percentile(ratios, 0.5) : null;

    // 글 덩어리: 위아래로 붙어 있고(문단 간격 없음) 왼쪽 시작이 비슷한 줄들. 덩어리의 오른쪽 끝을 R로 본다.
    var blocks = [], block = null;
    for (i = 0; i < n; i++) {
      var L = lines[i];
      L.R = null;
      if (!usable(L, mainDir) || L.tab) { block = null; continue; }
      var P = i > 0 ? lines[i - 1] : null;
      var same = false;
      if (block && P && block.last === P) {
        var rr = L.size / P.size, dd = P.v - L.v;
        same = rr >= 0.8 && rr <= 1.25 && dd >= 0.5 * P.size && dd <= gapLimit(P, L, pitch) && Math.abs(L.x0 - P.x0) <= 4 * P.size;
      }
      if (!same) { block = { lines: [] }; blocks.push(block); }
      block.lines.push(L);
      block.last = L;
    }
    blocks.forEach(function (b) {
      var m = b.lines.length;
      if (m < 2) return;
      var x1s = sortedCopy(b.lines.map(function (l) { return l.x1; }));
      var R = m >= 4 ? x1s[m - 2] : x1s[m - 1];          // 4줄 이상이면 가장 긴 줄 하나는 튀는 값으로 보고 뺀다
      var left = Math.min.apply(null, b.lines.map(function (l) { return l.x0; }));
      var s = percentile(b.lines.map(function (l) { return l.size; }), 0.5);
      if (R - left < 15 * s) return;                     // 좁은 덩어리(제목·주소 등)는 이어 붙이지 않는다
      if (m >= 4) {                                      // 줄 끝이 들쭉날쭉한 덩어리(시·목록)는 제외
        var full = 0;
        for (j = 0; j < m - 1; j++) if (b.lines[j].x1 >= R - 3 * s) full++;
        if (full / (m - 1) < 0.5) return;
      }
      b.lines.forEach(function (l) { l.R = R; l.left = left; });
    });
    return { mainDir: mainDir, pitch: pitch };
  }

  function isBreak(A, B, ctx) {
    if (!usable(A, ctx.mainDir) || !usable(B, ctx.mainDir)) return false;
    if (A.tab && B.tab) return false;                    // 같은 표의 줄
    var d = A.v - B.v;
    var s = Math.max(A.size, B.size);
    if (d < -0.5 * s) return true;                       // 위로 올라감: 다음 단·다른 덩어리
    return d > gapLimit(A, B, ctx.pitch) && d > 1.25 * s;
  }

  /** B가 새 목록 항목으로 시작하는지. ‘다. ’처럼 한글 한 글자+마침표는 글자 단위 줄바꿈에서 문장 끝 조각일 수 있어,
      앞 줄이 한글로 끝나 문장이 끝나지 않았으면 목록 기호로 보지 않는다. */
  function isListStart(A, B) {
    if (!LIST_MARK.test(B.text)) return false;
    if (/^[가-힣][.)]\s/.test(B.text) && HANGUL.test(A.text.slice(-1))) return false;
    return true;
  }

  /** ‘문단으로 이어 붙이기’에서 B를 A 뒤에 이어 붙일지 */
  function canMerge(A, B, ctx) {
    if (!usable(A, ctx.mainDir) || !usable(B, ctx.mainDir)) return false;
    if (A.tab || B.tab || A.R == null || B.R == null) return false;
    var s = A.size;
    var r = B.size / s;
    if (r < 0.85 || r > 1.18) return false;              // 글자 크기가 다름(제목 등)
    var d = A.v - B.v;
    var avail = A.R - A.x1;                              // 줄 끝에 남은 자리
    if (d < -2 * s && B.x0 - A.x0 > 10 * s) {
      // 다음 단(오른쪽 단의 맨 위)으로 이어지는 문단: 앞 줄이 꽉 찼고, 다음 줄이 그 단에서 들여 쓰지 않았을 때
      if (B.x0 > B.left + 0.8 * s || isListStart(A, B)) return false;
      return avail < 0.25 * s + B.firstW;
    }
    if (d < 0.5 * s || d > gapLimit(A, B, ctx.pitch)) return false;  // 바로 아래 줄이 아님
    var indent = B.x0 - A.x0;
    if (Math.abs(indent) > 4 * s) return false;          // 다른 단
    // 다음 줄이 들여 쓰여 있으면 새 문단. 다만 목록 항목의 둘째 줄(내어쓰기)은 이어 붙인다.
    if (indent > 0.8 * s && !LIST_MARK.test(A.text)) return false;
    if (isListStart(A, B)) return false;                 // 다음 목록 항목
    if (HYPHEN_END.test(A.text) && LOWER_START.test(B.text)) return avail < 4 * s;
    // 다음 줄 첫 낱말이 남은 자리에 들어갈 수 있었다면, 일부러 줄을 바꾼 것(문단 끝)으로 본다
    return avail < 0.25 * s + B.firstW;
  }

  /**
   * 한 쪽 분량의 PDF.js textContent를 정리해, 보관용 줄 목록으로 만든다.
   * 줄마다 t(글자), b(앞 줄과 사이에 빈 줄), m(문단 모드에서 앞 줄에 이어 붙임)를 담는다.
   */
  function preparePage(textContent) {
    var lines = buildLines(textContent.items || [], textContent.styles);
    var ctx = analyze(lines);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L.text) continue;
      var rec = { t: L.text, b: false, m: false };
      if (i > 0) {
        var P = lines[i - 1];
        rec.m = canMerge(P, L, ctx);
        rec.b = !rec.m && isBreak(P, L, ctx);
      }
      out.push(rec);
    }
    return out;
  }

  /* ---------- 3. 한글 줄 잇기: 줄이 바뀐 자리에 띄어쓰기가 있었는지 ---------- */
  // 어절 단위로 줄을 바꾼 문서는 줄바꿈 자리가 곧 띄어쓰기이고,
  // 글자 단위로 바꾼 문서(MS Word의 ‘한글 단어 잘림 허용’, 웹 브라우저 등)는 낱말 가운데서 줄이 바뀌기도 한다.
  // 어느 쪽인지는 문서 전체의 줄 첫머리·끝 낱말 통계로 판단한다.

  var EDGE_PUNCT = /^[\s"'“”‘’()[\]{}<>「」『』【】〈〉《》.,!?;:…·~\-–—]+|[\s"'“”‘’()[\]{}<>「」『』【】〈〉《》.,!?;:…·~\-–—]+$/g;
  function coreWord(tok) { return tok.replace(EDGE_PUNCT, ''); }
  var SUFFIX1 = '을를은는의에로와과게고며면서요죠께랑지데니';  // 낱말 첫머리로는 거의 안 쓰는 조사·어미 한 글자
  var SUFFIX1_LOOSE = '이가도만다나야';                         // 낱말로도 쓰여서, 글자 단위 줄바꿈 문서에서만 조사로 본다
  var ENDINGS = ['니다', '습니다', '었다', '였다', '겠다', '었습', '였습', '에서', '에게', '으로', '까지', '부터', '처럼',
    '이다', '이며', '이고', '이라', '이나', '지만', '니까', '므로', '도록', '면서', '는데', '은데', '려고', '려면',
    '아서', '어요', '아요', '에요', '예요', '이에요', '라는', '라고'];

  /** 줄 첫 낱말이 앞 낱말에 붙는 조사·어미 조각처럼 보이는지 */
  function suffixLike(raw, loose) {
    var tok = coreWord(raw);
    if (!tok || !HANGUL.test(tok.charAt(0))) return false;
    if (tok.length === 1) {
      if (SUFFIX1.indexOf(tok) >= 0) return true;
      if (/^[가-힣][.,!?…]/.test(raw.replace(/^\s+/, ''))) return true;   // 한 글자 + 문장부호: 문장 끝 어미 조각
      return !!loose && SUFFIX1_LOOSE.indexOf(tok) >= 0;
    }
    var c = tok.charAt(0);
    if (c === '를' || c === '는') return true;
    for (var i = 0; i < ENDINGS.length; i++) if (tok.indexOf(ENDINGS[i]) === 0) return true;
    return false;
  }

  function lastToken(s) { var m = /(\S+)\s*$/.exec(s); return m ? m[1] : ''; }
  function firstToken(s) { var m = /^\s*(\S+)/.exec(s); return m ? m[1] : ''; }
  function inc(map, k) { map.set(k, (map.get(k) || 0) + 1); }

  /** 문서 전체에서 낱말·글자 통계를 모아, 한글 줄 잇기의 판단 근거로 쓴다. */
  function koreanModel(doc) {
    var freq = new Map(), init = new Map(), fin = new Map(), seen = new Map();
    var tokLen = 0, tokN = 0;
    var joins = 0, hits = 0, fragLen = 0;
    doc.pages.forEach(function (p) {
      if (p.err) return;
      p.lines.forEach(function (L, idx) {
        var toks = L.t.split(/\s+/);
        for (var i = 1; i < toks.length - 1; i++) {      // 줄 첫·끝 낱말은 줄바꿈에 잘린 조각일 수 있어 빼고 센다
          var w = coreWord(toks[i]);
          if (!w) continue;
          inc(freq, w);
          var hs = 0;
          for (var k = 0; k < w.length; k++) {
            var ch = w[k];
            if (!HANGUL.test(ch)) continue;
            hs++;
            inc(seen, ch);
            if (k === 0) inc(init, ch);
            if (k === w.length - 1) inc(fin, ch);
          }
          if (hs) { tokLen += hs; tokN++; }
        }
        if (idx > 0 && L.m) {
          var prev = p.lines[idx - 1].t;
          if (HANGUL.test(prev.slice(-1)) && HANGUL.test(L.t.charAt(0))) {
            joins++;
            if (suffixLike(firstToken(L.t), false)) hits++;
            fragLen += (coreWord(lastToken(prev)).match(/[가-힣]/g) || []).length + (coreWord(firstToken(L.t)).match(/[가-힣]/g) || []).length;
          }
        }
      });
    });
    var meanTok = tokN ? tokLen / tokN : 3;
    var meanFrag = joins ? fragLen / (2 * joins) : meanTok;
    // 줄 첫머리가 조사·어미로 시작하는 일이 잦거나, 줄 끝·첫 낱말이 유난히 짧으면 글자 단위 줄바꿈 문서로 본다
    var charLevel = joins >= 3 && ((hits >= 2 && hits / joins >= 0.12) || (joins >= 6 && meanFrag < 0.72 * meanTok));
    return { freq: freq, init: init, fin: fin, seen: seen, charLevel: charLevel };
  }

  /** 한글로 끝난 줄과 한글로 시작하는 줄을 이을 때 띄어쓰기를 넣을지 */
  function hangulGlue(prevText, nextText, km) {
    var w1raw = lastToken(prevText), w2raw = firstToken(nextText);
    if (suffixLike(w2raw, km && km.charLevel)) return '';
    if (!km) return ' ';
    var w1 = coreWord(w1raw), w2 = coreWord(w2raw);
    if (km.freq.get(w1 + w2)) return '';                  // 붙여 쓴 꼴이 문서 다른 곳에 나옴
    if (km.freq.get(w1) && km.freq.get(w2)) return ' ';  // 두 낱말이 각각 따로 쓰인 적이 있음
    if (km.charLevel) {
      // 글자 단위 줄바꿈 문서: 줄바꿈 자리는 낱말 가운데인 경우가 더 많으므로, 낱말 경계라는 근거가 모일 때만 띄운다
      var a = w1.slice(-1), b = w2.charAt(0), score = 0;
      if ((w1.match(/[가-힣]/g) || []).length >= 2) {   // 앞 낱말이 조사·어미로 끝남
        if ('를는'.indexOf(a) >= 0) score += 3;
        else if ('을은에와로서면며께'.indexOf(a) >= 0) score += 2;
        else if (a === '다') score += 0.5;
      }
      var sb = km.seen.get(b) || 0;
      if (sb >= 2) {                                     // 이 문서에서 b가 낱말 첫 글자로 쓰인 비율
        var pb = ((km.init.get(b) || 0) + 0.5) / (sb + 1);
        if (pb >= 0.8) score += 1.5;
        else if (sb >= 5 && pb < 0.15) score -= 1.5;
      }
      return score > 0 ? ' ' : '';
    }
    return ' ';
  }

  /* ---------- 4. 쪽·파일 텍스트 ---------- */

  function joinTo(out, next, km) {
    var last = out.slice(-1), prev = out.slice(-2, -1), first = next.charAt(0);
    if (last === '\u00AD') return out.slice(0, -1) + next;                        // 소프트 하이픈
    if ((last === '-' || last === '\u2010') && /\p{L}/u.test(prev) && LOWER_START.test(next)) return out.slice(0, -1) + next; // 영어 낱말 나눔
    if (CJK_NOSPACE.test(last) && CJK_NOSPACE.test(first)) return out + next;
    if (CLOSE_PUNCT.test(next) || OPEN_PUNCT.test(last)) return out + next;
    if (HANGUL.test(first) && /[\p{L}\p{N}]/u.test(last)) {
      if (HANGUL.test(last)) return out + hangulGlue(out, next, km) + next;
      if (suffixLike(firstToken(next), km && km.charLevel)) return out + next;    // 예: PDF + 에서
    }
    return out + ' ' + next;
  }

  function pageText(lines, mode, km) {
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!out) out = L.t;
      else if (mode === 'paragraphs' && L.m) out = joinTo(out, L.t, km);
      else out += (L.b ? '\n\n' : '\n') + L.t;
    }
    return out;
  }

  var KO_PARTICLE_AFTER_LATIN = /([A-Za-z0-9%])[ ]+(을|를|은|는|의|에|로|와|과|에서|에게|으로|까지|부터|처럼|보다|이다|입니다|이라는|라는|이란|에는|에도|에서는|으로는|로는|이나|이며|이고)(?=[\s.,!?)\]」』”’]|$)/g;

  function finalize(text) {
    text = text.normalize('NFC')
      .replace(/\r\n?/g, '\n').replace(LINE_SEP, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/ {2,}/g, ' ')
      // PDF 안의 글꼴이 바뀌는 자리에 생긴 틈 때문에 끼어든 띄어쓰기(한글 표기에서 쓰지 않는 자리)를 뺀다
      .replace(/([가-힣]) +([.,!?])(?=[\s"'”’)\]」』]|$)/g, '$1$2')
      .replace(/([가-힣]) +([)\]」』])/g, '$1$2')
      .replace(/([(\[「『]) +(?=[가-힣])/g, '$1')
      .replace(KO_PARTICLE_AFTER_LATIN, '$1$2')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ ]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
    return text ? text + '\n' : '';
  }

  /**
   * 파일 하나의 최종 텍스트.
   * doc.pages: [{ lines, annots, err }], opts: { mode: 'lines'|'paragraphs', pageMarks, forms }
   */
  function docText(doc, opts) {
    var km = opts.mode === 'paragraphs' ? koreanModel(doc) : null;
    var parts = [];
    var total = doc.pages.length;
    for (var i = 0; i < total; i++) {
      var p = doc.pages[i];
      var body = p.err ? '' : pageText(p.lines, opts.mode, km);
      if (opts.forms && p.annots && p.annots.length) body += (body ? '\n\n' : '') + '[입력란·글상자]\n' + p.annots.join('\n');
      if (opts.pageMarks && total > 1) {
        var note = p.err ? '(이 쪽은 읽지 못했습니다)'
          : p.ocrTried ? '(글자 없음 — 문자인식으로도 글자를 찾지 못한 쪽)' : '(글자 없음 — 그림이나 스캔한 쪽)';
        parts.push('===== ' + (i + 1) + ' / ' + total + '쪽' + (p.ocr ? ' (문자인식)' : '') + ' =====\n' + (body || note));
      } else if (body) parts.push(body);
    }
    return finalize(parts.join('\n\n'));
  }

  /* ---------- 5. 양식 입력값·글상자 ---------- */

  function fieldLabel(a) {
    var alt = (a.alternativeText || '').trim();
    if (alt) return alt;
    var name = String(a.fieldName || '').trim();
    var leaf = name.split('.').pop();
    if (!leaf || leaf.length > 40 || /[\[\]]/.test(leaf) || /^(?:text|field|check ?box|radio|untitled)\s*\d*$/i.test(leaf)) return '';
    return leaf;
  }

  /**
   * 쪽에 붙은 주석 중 사람이 입력한 글자를 꺼낸다(본문에 들어 있지 않아 일반 추출로는 빠지는 것).
   * 글상자(FreeText) 내용, 양식의 글 입력란·선택 목록 값, 체크된 체크박스·라디오 단추.
   */
  function annotationTexts(annots) {
    var list = (annots || []).filter(function (a) { return a && Array.isArray(a.rect); }).slice();
    list.sort(function (a, b) { return (b.rect[3] - a.rect[3]) || (a.rect[0] - b.rect[0]); });
    var out = [];
    list.forEach(function (a) {
      var v, label;
      if (a.annotationType === 3) {                           // 글상자
        v = (Array.isArray(a.textContent) && a.textContent.join('\n')) || (a.contentsObj && a.contentsObj.str) || '';
        v = String(v).trim();
        if (v) out.push(v);
      } else if (a.annotationType === 20) {                   // 양식 칸
        label = fieldLabel(a);
        if (a.fieldType === 'Tx' || a.fieldType === 'Ch') {
          v = a.fieldValue;
          if (Array.isArray(v)) {
            if (a.fieldType === 'Ch' && Array.isArray(a.options)) {
              v = v.map(function (x) {
                var o = a.options.find(function (op) { return op.exportValue === x; });
                return o && o.displayValue ? o.displayValue : x;
              });
            }
            v = v.join(', ');
          }
          v = v == null ? '' : String(v).trim();
          if (v) out.push(label ? label + ': ' + v : v);
        } else if (a.fieldType === 'Btn' && (a.checkBox || a.radioButton)) {
          var on = a.checkBox ? (a.fieldValue != null && a.fieldValue !== 'Off' && a.fieldValue === a.exportValue)
            : (a.fieldValue != null && a.fieldValue === a.buttonValue);
          if (on) {
            var what = label || '';
            var val = a.checkBox ? '' : String(a.buttonValue || '');
            if (val && val !== 'Off' && what) what += ': ' + val; else if (!what) what = val;
            if (what) out.push('[선택] ' + what);
          }
        }
      }
    });
    return out;
  }

  /* ---------- 6. 진단 ---------- */

  function diagnose(doc) {
    var empty = [], errs = [], ocr = [], lowConf = [], rotated = [], confSum = 0, chars = 0, odd = 0, latin1 = 0, letters = 0;
    doc.pages.forEach(function (p, i) {
      if (p.err) { errs.push(i + 1); return; }
      var compact = p.lines.map(function (l) { return l.t; }).join('').replace(/\s+/g, '');
      if (!compact && !(p.annots && p.annots.length)) empty.push(i + 1);
      if (p.ocr) {
        ocr.push(i + 1);
        confSum += p.ocr.conf;
        if (p.ocr.conf < 60) lowConf.push(i + 1);
        if (p.ocr.rot) rotated.push(i + 1);
        return;                                           // 문자인식 결과는 글꼴 깨짐 검사에서 뺀다
      }
      chars += compact.length;
      odd += (compact.match(/[\uE000-\uF8FF\uFFFD]/g) || []).length;
      latin1 += (compact.match(/[À-ÿ]/g) || []).length;
      letters += (compact.match(/\p{L}/gu) || []).length;
    });
    return {
      emptyPages: empty,
      errorPages: errs,
      ocrPages: ocr,
      ocrConf: ocr.length ? Math.round(confSum / ocr.length) : null,
      lowConfPages: lowConf,
      rotatedPages: rotated,
      chars: chars,
      garbled: chars > 0 && (odd / chars > 0.02 || (letters > 50 && latin1 / letters > 0.3))
    };
  }

  /* ---------- 6-1. 문자인식(OCR) 결과 ---------- */

  function pageChars(lines) { return lines.map(function (l) { return l.t; }).join('').replace(/\s+/g, '').length; }

  /** 글자가 거의 없는 쪽(10자 미만)은 스캔한 쪽일 수 있어 문자인식 대상으로 본다 */
  function needsOcr(p) { return !p.err && !p.ocr && pageChars(p.lines) < 10; }

  /**
   * Tesseract 결과(blocks → paragraphs → lines)를 보관용 줄 목록으로 바꾼다.
   * 문단의 첫 줄은 앞에 빈 줄(b), 문단 안의 다음 줄은 ‘문단으로 이어 붙이기’ 대상(m).
   */
  function ocrLines(data) {
    var out = [];
    // 쪽 전체 신뢰도가 아주 낮으면(글자 없는 사진·무늬 쪽 등) 꽤 믿을 만한 줄만 남겨, 엉뚱한 글자가 섞이지 않게 한다
    var minConf = data && typeof data.confidence === 'number' && data.confidence < 50 ? 60 : 0;
    ((data && data.blocks) || []).forEach(function (blk) {
      (blk.paragraphs || []).forEach(function (par) {
        var first = true;
        (par.lines || []).forEach(function (ln) {
          var t = String(ln.text || '').replace(/\s+/g, ' ').trim();
          if (!t || (ln.confidence || 0) < minConf) return;
          if ((ln.confidence || 0) < 30 && !/[\p{L}\p{N}]{2}/u.test(t)) return;   // 그림 테두리·얼룩에서 나온 잡음
          out.push({ t: t, b: out.length > 0 && first, m: !first });
          first = false;
        });
      });
    });
    return out;
  }

  /** 문자인식 결과가 원래 꺼낸 글자보다 확실히 많을 때만 바꾼다(쪽 번호만 글자로 찍힌 스캔 쪽 등) */
  function preferOcr(oldLines, newLines) { return pageChars(newLines) > pageChars(oldLines) + 10; }

  /** [1,2,3,5,8,9] → "1–3, 5, 8–9" */
  function pageRanges(nums, max) {
    var parts = [], i = 0;
    while (i < nums.length) {
      var j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push(i === j ? String(nums[i]) : nums[i] + '–' + nums[j]);
      i = j + 1;
    }
    max = max || 12;
    if (parts.length > max) return parts.slice(0, max).join(', ') + ' 외';
    return parts.join(', ');
  }

  /* ---------- 7. 파일로 만들기 ---------- */

  function countChars(text) { return text.replace(/\s+/g, '').length; }

  /** windows: 구형 Windows 메모장도 알아보도록 BOM과 CRLF 줄바꿈을 쓴다 */
  function encodeTxt(text, windows) {
    var body = new TextEncoder().encode(windows ? text.replace(/\n/g, '\r\n') : text);
    if (!windows) return body;
    var out = new Uint8Array(body.length + 3);
    out.set([0xEF, 0xBB, 0xBF], 0);
    out.set(body, 3);
    return out;
  }

  function txtName(pdfName) {
    var base = String(pdfName || '').replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
    return (base || '문서') + '.txt';
  }

  function uniqueNames(names) {
    var seen = Object.create(null);
    return names.map(function (n) {
      var key = n.toLowerCase();
      if (!seen[key]) { seen[key] = 1; return n; }
      var dot = n.lastIndexOf('.');
      var stem = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : '';
      var k = ++seen[key], cand;
      do { cand = stem + ' (' + k + ')' + ext; k++; } while (seen[cand.toLowerCase()]);
      seen[cand.toLowerCase()] = 1;
      return cand;
    });
  }

  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /** 압축하지 않는(stored) ZIP의 조각들. 파일 이름은 UTF-8로 표시한다. files: [{ name, data: Uint8Array }] */
  function makeZip(files, date) {
    var enc = new TextEncoder();
    var d = date || new Date();
    var time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    var day = (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    var chunks = [], central = [], offset = 0, cdSize = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var crc = crc32(f.data), size = f.data.length;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, day, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, f.data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true);
      ch.setUint16(14, day, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true);
      ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
      cdSize += 46 + name.length;
    });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    return chunks.concat(central, [new Uint8Array(end.buffer)]);
  }

  /** 파일 앞부분이 PDF 머리말(%PDF-)을 담고 있는지 */
  function looksLikePdf(bytes) {
    var n = Math.min(bytes.length, 1024);
    for (var i = 0; i + 4 < n; i++) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2D) return true;
    }
    return false;
  }

  return {
    buildLines: buildLines,
    preparePage: preparePage,
    pageText: pageText,
    docText: docText,
    annotationTexts: annotationTexts,
    diagnose: diagnose,
    needsOcr: needsOcr,
    ocrLines: ocrLines,
    preferOcr: preferOcr,
    pageChars: pageChars,
    pageRanges: pageRanges,
    countChars: countChars,
    encodeTxt: encodeTxt,
    txtName: txtName,
    uniqueNames: uniqueNames,
    crc32: crc32,
    makeZip: makeZip,
    looksLikePdf: looksLikePdf,
    _internal: { analyze: analyze, canMerge: canMerge, isBreak: isBreak, joinTo: joinTo, finalize: finalize, suffixLike: suffixLike, koreanModel: koreanModel, hangulGlue: hangulGlue, LIST_MARK: LIST_MARK }
  };
});
