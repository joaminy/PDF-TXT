"""PDF → TXT 앱 묶기: PDF.js·문자인식(Tesseract) 파일 복사, 서비스 워커(파일 목록·해시) 생성. 아이콘은 --icons일 때만 다시 그린다.

사용법 (앱 파일을 고친 뒤에는 꼭 다시 실행해 sw.js의 파일 목록·해시를 새로 만든다):
    cd tools
    npm install                # pdfjs-dist·tesseract.js·학습 데이터를 tools/node_modules에 받는다(처음 한 번)
    python3 build.py           # 빌드 번호는 오늘 날짜
    python3 build.py --icons   # 아이콘까지 다시 그리기(Pillow·DejaVu 글꼴 필요)
"""
import hashlib, json, os, re, shutil, sys, datetime

args = [a for a in sys.argv[1:] if not a.startswith('--')]
ICONS = '--icons' in sys.argv
BUILD = os.path.dirname(os.path.abspath(__file__))
APP = args[0] if args else os.path.dirname(BUILD)
PDFJS = os.path.join(BUILD, 'node_modules', 'pdfjs-dist')
BUILD_ID = args[1] if len(args) > 1 else datetime.date.today().strftime('%Y.%m.%d')
if not os.path.isdir(PDFJS):
    sys.exit('tools 폴더에서 먼저 npm install 을 실행하세요.')

# 1) PDF.js (legacy build: 오래된 휴대폰 브라우저까지 고려). .mjs는 정적 호스팅에서 형식이 틀리게 나가는 일이 있어 .js로 둔다.
v = os.path.join(APP, 'vendor', 'pdfjs')
shutil.rmtree(os.path.join(APP, 'vendor'), ignore_errors=True)
os.makedirs(os.path.join(v, 'cmaps'))
os.makedirs(os.path.join(v, 'standard_fonts'))
shutil.copy(os.path.join(PDFJS, 'legacy/build/pdf.min.mjs'), os.path.join(v, 'pdf.min.js'))
shutil.copy(os.path.join(PDFJS, 'legacy/build/pdf.worker.min.mjs'), os.path.join(v, 'pdf.worker.min.js'))
for f in os.listdir(os.path.join(PDFJS, 'cmaps')):
    if f.endswith('.bcmap'):
        shutil.copy(os.path.join(PDFJS, 'cmaps', f), os.path.join(v, 'cmaps', f))
for f in os.listdir(os.path.join(PDFJS, 'standard_fonts')):
    if f.endswith(('.pfb', '.ttf')):
        shutil.copy(os.path.join(PDFJS, 'standard_fonts', f), os.path.join(v, 'standard_fonts', f))
# 그림 해독기: 스캔 PDF에 흔한 JPEG 2000·JBIG2 그림과 색 공간(ICC)을 그릴 때 쓴다(문자인식용으로 쪽을 그릴 때 필요)
os.makedirs(os.path.join(v, 'wasm'))
for f in ('openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm'):
    shutil.copy(os.path.join(PDFJS, 'wasm', f), os.path.join(v, 'wasm', f))

# 문자인식: tesseract.js(화면 쪽 라이브러리·작업자), 엔진(wasm 포함 JS, SIMD/일반 두 가지), 한국어·영어 학습 데이터
NM = os.path.join(BUILD, 'node_modules')
t = os.path.join(APP, 'vendor', 'tesseract')
os.makedirs(os.path.join(t, 'lang'))
shutil.copy(os.path.join(NM, 'tesseract.js/dist/tesseract.min.js'), os.path.join(t, 'tesseract.min.js'))
w = open(os.path.join(NM, 'tesseract.js/dist/worker.min.js'), encoding='utf-8').read()
# tesseract.js 7.0.0의 버그 수정: 학습 데이터를 직접 넘기면({code, data}) 초기화 때 언어 이름 대신 데이터를 써서 실패한다
BUG = 'return"string"==typeof t?t:t.data})).join("+"),c="initializing api"'
if BUG in w:
    assert w.count(BUG) == 1
    w = w.replace(BUG, 'return"string"==typeof t?t:t.code})).join("+"),c="initializing api"')
elif 'return"string"==typeof t?t:t.code})).join("+"),c="initializing api"' not in w:
    sys.exit('tesseract.js 작업자 코드가 바뀌었습니다. 언어 데이터 직접 전달 부분을 다시 확인하세요.')
open(os.path.join(t, 'worker.min.js'), 'w', encoding='utf-8').write(w)
for f in ('tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'):
    shutil.copy(os.path.join(NM, 'tesseract.js-core', f), os.path.join(t, f))
for lang in ('kor', 'eng'):
    shutil.copy(os.path.join(NM, '@tesseract.js-data', lang, '4.0.0_best_int', lang + '.traineddata.gz'), os.path.join(t, 'lang', lang + '.traineddata.gz'))
tver = json.load(open(os.path.join(NM, 'tesseract.js/package.json')))['version']
cver = json.load(open(os.path.join(NM, 'tesseract.js-core/package.json')))['version']
lic = os.path.join(APP, 'LICENSES')
shutil.rmtree(lic, ignore_errors=True)
os.makedirs(lic)
shutil.copy(os.path.join(PDFJS, 'LICENSE'), os.path.join(lic, 'pdfjs-LICENSE'))
shutil.copy(os.path.join(PDFJS, 'cmaps', 'LICENSE'), os.path.join(lic, 'cmaps-LICENSE'))
shutil.copy(os.path.join(PDFJS, 'standard_fonts', 'LICENSE_FOXIT'), os.path.join(lic, 'standard_fonts-LICENSE_FOXIT'))
shutil.copy(os.path.join(PDFJS, 'standard_fonts', 'LICENSE_LIBERATION'), os.path.join(lic, 'standard_fonts-LICENSE_LIBERATION'))
for f in ('LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2', 'LICENSE_QCMS', 'LICENSE_PDFJS_QCMS'):
    shutil.copy(os.path.join(PDFJS, 'wasm', f), os.path.join(lic, 'wasm-' + f))
ver = json.load(open(os.path.join(PDFJS, 'package.json')))['version']
_NM = os.path.join(BUILD, 'node_modules')
shutil.copy(os.path.join(_NM, 'tesseract.js/LICENSE.md'), os.path.join(lic, 'tesseract.js-LICENSE'))
shutil.copy(os.path.join(_NM, 'tesseract.js/dist/worker.min.js.LICENSE.txt'), os.path.join(lic, 'tesseract.js-worker-bundled-LICENSES.txt'))
shutil.copy(os.path.join(_NM, 'tesseract.js-core/LICENSE'), os.path.join(lic, 'tesseract.js-core-LICENSE'))
open(os.path.join(lic, 'tessdata-NOTICE.txt'), 'w', encoding='utf-8').write(
    'vendor/tesseract/lang/kor.traineddata.gz, eng.traineddata.gz\n'
    'Source: tesseract-ocr/tessdata_best (Apache License 2.0), integer-converted and packaged by\n'
    '@tesseract.js-data/kor and @tesseract.js-data/eng 1.0.0 (npm, MIT license for the packaging).\n'
    'https://github.com/tesseract-ocr/tessdata_best  https://github.com/naptha/tessdata\n')

# 2) 아이콘: 파란 바탕 위 흰 종이, 위쪽에 ‘TXT’, 아래 글줄
BLUE = (43, 87, 151)
LINE = (168, 182, 204)

def draw_icon(size, maskable=False, rounded=True):
    from PIL import Image, ImageDraw, ImageFont
    S = 1024  # 크게 그린 뒤 줄여서 테두리를 매끄럽게
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, S, S], fill=BLUE)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2), fill=BLUE)
    scale = 0.72 if maskable else 1.0   # maskable은 안전 영역(가운데 80%) 안에 들어가게
    def P(x, y):
        return (S / 2 + (x - S / 2) * scale, S / 2 + (y - S / 2) * scale)
    # 종이(오른쪽 위 접힌 모서리)
    x0, y0, x1, y1, fold = 262, 170, 762, 854, 150
    d.polygon([P(x0, y0), P(x1 - fold, y0), P(x1, y0 + fold), P(x1, y1), P(x0, y1)], fill=(255, 255, 255))
    d.polygon([P(x1 - fold, y0), P(x1 - fold, y0 + fold), P(x1, y0 + fold)], fill=(208, 220, 238))
    # TXT
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int(150 * scale))
    tx, ty = P(330, 300)
    d.text((tx, ty), 'TXT', font=font, fill=BLUE)
    # 글줄
    lw = int(44 * scale)
    for i, (a, b) in enumerate([(330, 694), (330, 694), (330, 600), (330, 694), (330, 540)]):
        y = 520 + i * 66
        (ax, ay), (bx, by) = P(a, y), P(b, y)
        d.rounded_rectangle([ax, ay, bx, ay + lw * 0.62], radius=lw * 0.31, fill=LINE)
    return img.resize((size, size), Image.LANCZOS)

ic = os.path.join(APP, 'icons')
if ICONS or not os.path.isdir(ic):
  shutil.rmtree(ic, ignore_errors=True)
  os.makedirs(ic)
  draw_icon(192).save(os.path.join(ic, 'icon-192.png'), optimize=True)
  draw_icon(512).save(os.path.join(ic, 'icon-512.png'), optimize=True)
  draw_icon(512, maskable=True).save(os.path.join(ic, 'icon-maskable-512.png'), optimize=True)
  # iOS는 모서리를 스스로 둥글게 깎으므로 꽉 찬 사각형으로
  draw_icon(180, rounded=False).convert('RGB').save(os.path.join(ic, 'apple-touch-icon.png'), optimize=True)
  draw_icon(32).save(os.path.join(ic, 'favicon-32.png'), optimize=True)

# 3) 빌드 번호
idx = os.path.join(APP, 'index.html')
html = open(idx, encoding='utf-8').read()
html = re.sub(r'<meta name="app-build" content="[^"]*">', '<meta name="app-build" content="%s">' % BUILD_ID, html)
html = re.sub(r'PDF\.js [0-9.]+\(Apache-2\.0\)', 'PDF.js %s(Apache-2.0)' % ver, html)
open(idx, 'w', encoding='utf-8').write(html)
open(os.path.join(APP, '.nojekyll'), 'w').close()

# 4) 서비스 워커: 앱이 쓰는 파일과 내용 해시
def sha16(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()[:16]

# 문자인식 큰 파일(처음 쓸 때 받음)과 그 목록
optional = [
    {'path': 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'kind': 'core', 'simd': True},
    {'path': 'vendor/tesseract/tesseract-core-lstm.wasm.js', 'kind': 'core', 'simd': False},
    {'path': 'vendor/tesseract/lang/kor.traineddata.gz', 'kind': 'lang', 'lang': 'kor'},
    {'path': 'vendor/tesseract/lang/eng.traineddata.gz', 'kind': 'lang', 'lang': 'eng'},
]
for o in optional:
    full = os.path.join(APP, o['path'])
    o['size'] = os.path.getsize(full)
    o['hash'] = sha16(full)
json.dump({'tesseract': tver, 'core': cver, 'files': optional}, open(os.path.join(APP, 'ocr-assets.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

runtime = ['index.html', 'app.js', 'app.css', 'textcore.js', 'ocr.js', 'manifest.webmanifest', 'ocr-assets.json']
runtime += ['icons/' + f for f in sorted(os.listdir(ic))]
runtime += ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js']
runtime += ['vendor/pdfjs/cmaps/' + f for f in sorted(os.listdir(os.path.join(v, 'cmaps')))]
runtime += ['vendor/pdfjs/standard_fonts/' + f for f in sorted(os.listdir(os.path.join(v, 'standard_fonts')))]
runtime += ['vendor/pdfjs/wasm/' + f for f in sorted(os.listdir(os.path.join(v, 'wasm')))]
runtime += ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js']
files = [['./', sha16(idx)]] + [['./' + p, sha16(os.path.join(APP, p))] for p in runtime]
# 학습 데이터(.gz)는 서버가 압축을 풀어 보내더라도(Content-Encoding) 보관할 수 있게, 풀린 내용의 해시도 함께 허용한다.
# (tesseract.js는 받은 데이터의 앞 두 바이트로 gzip 여부를 보고 스스로 푼다)
import gzip
def opt_hashes(o):
    hs = [o['hash']]
    if o['path'].endswith('.gz'):
        hs.append(hashlib.sha256(gzip.decompress(open(os.path.join(APP, o['path']), 'rb').read())).hexdigest()[:16])
    return hs
opt = [['./' + o['path'], opt_hashes(o)] for o in optional]
version = hashlib.sha256(json.dumps([files, opt]).encode()).hexdigest()[:12]
tpl = open(os.path.join(BUILD, 'sw.template.js'), encoding='utf-8').read()
sw = tpl.replace('__VERSION__', version).replace('__FILES__', json.dumps(files, indent=0)).replace('__OPTIONAL__', json.dumps(opt, indent=0))
open(os.path.join(APP, 'sw.js'), 'w', encoding='utf-8').write(sw)

total = sum(os.path.getsize(os.path.join(APP, p)) for p in runtime)
ocr_dl = sum(o['size'] for o in optional if o.get('simd', True) is not False)
print('PDF.js', ver, '| tesseract.js', tver, '| build', BUILD_ID, '| sw', version, '| 파일', len(files), '+ 선택', len(opt),
      '| 앱 %.1f MB, 문자인식(처음 쓸 때) %.1f MB' % (total / 1024 / 1024, ocr_dl / 1024 / 1024))
