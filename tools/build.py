"""PDF → TXT 앱 묶기: PDF.js 파일 복사, 서비스 워커(파일 목록·해시) 생성. 아이콘은 --icons일 때만 다시 그린다.

사용법 (앱 파일을 고친 뒤에는 꼭 다시 실행해 sw.js의 파일 목록·해시를 새로 만든다):
    cd tools
    npm install                # pdfjs-dist를 tools/node_modules에 받는다(처음 한 번)
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
lic = os.path.join(APP, 'LICENSES')
shutil.rmtree(lic, ignore_errors=True)
os.makedirs(lic)
shutil.copy(os.path.join(PDFJS, 'LICENSE'), os.path.join(lic, 'pdfjs-LICENSE'))
shutil.copy(os.path.join(PDFJS, 'cmaps', 'LICENSE'), os.path.join(lic, 'cmaps-LICENSE'))
shutil.copy(os.path.join(PDFJS, 'standard_fonts', 'LICENSE_FOXIT'), os.path.join(lic, 'standard_fonts-LICENSE_FOXIT'))
shutil.copy(os.path.join(PDFJS, 'standard_fonts', 'LICENSE_LIBERATION'), os.path.join(lic, 'standard_fonts-LICENSE_LIBERATION'))
ver = json.load(open(os.path.join(PDFJS, 'package.json')))['version']

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

runtime = ['index.html', 'app.js', 'app.css', 'textcore.js', 'manifest.webmanifest']
runtime += ['icons/' + f for f in sorted(os.listdir(ic))]
runtime += ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js']
runtime += ['vendor/pdfjs/cmaps/' + f for f in sorted(os.listdir(os.path.join(v, 'cmaps')))]
runtime += ['vendor/pdfjs/standard_fonts/' + f for f in sorted(os.listdir(os.path.join(v, 'standard_fonts')))]
files = [['./', sha16(idx)]] + [['./' + p, sha16(os.path.join(APP, p))] for p in runtime]
version = hashlib.sha256(json.dumps(files).encode()).hexdigest()[:12]
tpl = open(os.path.join(BUILD, 'sw.template.js'), encoding='utf-8').read()
sw = tpl.replace('__VERSION__', version).replace('__FILES__', json.dumps(files, indent=0))
open(os.path.join(APP, 'sw.js'), 'w', encoding='utf-8').write(sw)

total = sum(os.path.getsize(os.path.join(APP, p)) for p in runtime)
print('PDF.js', ver, '| build', BUILD_ID, '| sw', version, '| 파일', len(files), '| 앱 크기 %.1f MB' % (total / 1024 / 1024))
