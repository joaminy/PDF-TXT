/* PDF → TXT — 오프라인용 서비스 워커.
   앱 파일을 기기에 보관해 인터넷 없이도 열리게 한다. 다른 주소로는 어떤 요청도 보내지 않는다.
   사용자의 PDF와 문자인식용 그림은 이 워커를 거치지 않는다(화면에서 바로 메모리로 읽는다).
   예외: Android ‘공유 → PDF→TXT’로 받은 PDF는 앱이 열릴 때까지 기기 안 임시 보관함에 잠깐 두고, 앱이 꺼내는 즉시 지운다. */
'use strict';
const VERSION = '4445603c85bf';
const PREFIX = 'pdf2txt-app-';
const CACHE = PREFIX + VERSION;
const SHARE_CACHE = 'pdf2txt-share';
// 설치할 때 모두 받는 파일
const FILES = [
[
"./",
"7b496c6ab8109078"
],
[
"./index.html",
"7b496c6ab8109078"
],
[
"./app.js",
"5e08f1f49536aef4"
],
[
"./app.css",
"4688d9f2a50390b7"
],
[
"./textcore.js",
"74239fff2d8370d2"
],
[
"./ocr.js",
"0118f99e11b8f45b"
],
[
"./manifest.webmanifest",
"ee393959c5c7814a"
],
[
"./ocr-assets.json",
"d672b26860f3289f"
],
[
"./icons/apple-touch-icon.png",
"4fc4344108f1d75e"
],
[
"./icons/favicon-32.png",
"246891277b21e588"
],
[
"./icons/icon-192.png",
"6f4740a6a9d7a128"
],
[
"./icons/icon-512.png",
"bf813da3ae413c69"
],
[
"./icons/icon-maskable-512.png",
"7a1d17f99b7b68ff"
],
[
"./vendor/pdfjs/pdf.min.js",
"522ad2c83bc8a001"
],
[
"./vendor/pdfjs/pdf.worker.min.js",
"b4c8353ded0d88d2"
],
[
"./vendor/pdfjs/cmaps/78-EUC-H.bcmap",
"d92a261336dc18b8"
],
[
"./vendor/pdfjs/cmaps/78-EUC-V.bcmap",
"61670bebc4e4827b"
],
[
"./vendor/pdfjs/cmaps/78-H.bcmap",
"ece6415b853d61e1"
],
[
"./vendor/pdfjs/cmaps/78-RKSJ-H.bcmap",
"696b1f973c976234"
],
[
"./vendor/pdfjs/cmaps/78-RKSJ-V.bcmap",
"53cb6d560ab377da"
],
[
"./vendor/pdfjs/cmaps/78-V.bcmap",
"289000f02fd34872"
],
[
"./vendor/pdfjs/cmaps/78ms-RKSJ-H.bcmap",
"a2442595218f5f8b"
],
[
"./vendor/pdfjs/cmaps/78ms-RKSJ-V.bcmap",
"f8ddceba96bfd9d3"
],
[
"./vendor/pdfjs/cmaps/83pv-RKSJ-H.bcmap",
"44040051ec818fe0"
],
[
"./vendor/pdfjs/cmaps/90ms-RKSJ-H.bcmap",
"c13e043e85ff715b"
],
[
"./vendor/pdfjs/cmaps/90ms-RKSJ-V.bcmap",
"499bb916ce1adbe4"
],
[
"./vendor/pdfjs/cmaps/90msp-RKSJ-H.bcmap",
"7b8b3b8bbf821702"
],
[
"./vendor/pdfjs/cmaps/90msp-RKSJ-V.bcmap",
"6296c2b5c07dca81"
],
[
"./vendor/pdfjs/cmaps/90pv-RKSJ-H.bcmap",
"fb5103f03d3a3454"
],
[
"./vendor/pdfjs/cmaps/90pv-RKSJ-V.bcmap",
"7bcb5ad2ba55b966"
],
[
"./vendor/pdfjs/cmaps/Add-H.bcmap",
"a2ffab28b9909981"
],
[
"./vendor/pdfjs/cmaps/Add-RKSJ-H.bcmap",
"b29f4b52e2465d04"
],
[
"./vendor/pdfjs/cmaps/Add-RKSJ-V.bcmap",
"2aa2232c283a3f5d"
],
[
"./vendor/pdfjs/cmaps/Add-V.bcmap",
"25125d3b1be64e86"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-0.bcmap",
"8c65be9d51a9f269"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-1.bcmap",
"73152bc1a59cc594"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-2.bcmap",
"a1b8d353bdef9584"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-3.bcmap",
"2ffc0c75c79fafde"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-4.bcmap",
"98a1f470c878c6b9"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-5.bcmap",
"ddd6e29955eb8cb5"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-6.bcmap",
"317bb2db71e0e5b7"
],
[
"./vendor/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap",
"e665837f2197c6bd"
],
[
"./vendor/pdfjs/cmaps/Adobe-GB1-0.bcmap",
"8b81cce8a11d510e"
],
[
"./vendor/pdfjs/cmaps/Adobe-GB1-1.bcmap",
"0426983081788ec7"
],
[
"./vendor/pdfjs/cmaps/Adobe-GB1-2.bcmap",
"e67b37a83b160ab3"
],
[
"./vendor/pdfjs/cmaps/Adobe-GB1-3.bcmap",
"aa299afc3e12a287"
],
[
"./vendor/pdfjs/cmaps/Adobe-GB1-4.bcmap",
"8fbd7d74c2ddb135"
],
[
"./vendor/pdfjs/cmaps/Adobe-GB1-5.bcmap",
"c22cb2fcff24112f"
],
[
"./vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap",
"20507620260c0c93"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-0.bcmap",
"464f08905236f570"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-1.bcmap",
"4c823848722187d1"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-2.bcmap",
"7810fb808e367e70"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-3.bcmap",
"84deb1828711ad3d"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-4.bcmap",
"3f8a4f974919c2b8"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-5.bcmap",
"1d3ce4ff28d977f8"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-6.bcmap",
"5609797b9401b30b"
],
[
"./vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap",
"66c5d0dc4964f409"
],
[
"./vendor/pdfjs/cmaps/Adobe-Korea1-0.bcmap",
"dfb8c3874f0e5a8c"
],
[
"./vendor/pdfjs/cmaps/Adobe-Korea1-1.bcmap",
"62f277b7b1c441c0"
],
[
"./vendor/pdfjs/cmaps/Adobe-Korea1-2.bcmap",
"1d77068af462f96d"
],
[
"./vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap",
"857b723088be9725"
],
[
"./vendor/pdfjs/cmaps/B5-H.bcmap",
"718ad0ffbef4c34f"
],
[
"./vendor/pdfjs/cmaps/B5-V.bcmap",
"b5c3738351747762"
],
[
"./vendor/pdfjs/cmaps/B5pc-H.bcmap",
"bab6028aead1d614"
],
[
"./vendor/pdfjs/cmaps/B5pc-V.bcmap",
"41543142b9767f3b"
],
[
"./vendor/pdfjs/cmaps/CNS-EUC-H.bcmap",
"e8f89cd61e6486b9"
],
[
"./vendor/pdfjs/cmaps/CNS-EUC-V.bcmap",
"cae422bec2ac6dbe"
],
[
"./vendor/pdfjs/cmaps/CNS1-H.bcmap",
"e8487971ab20cd16"
],
[
"./vendor/pdfjs/cmaps/CNS1-V.bcmap",
"42df8076aaa75745"
],
[
"./vendor/pdfjs/cmaps/CNS2-H.bcmap",
"bc6024d274d440f0"
],
[
"./vendor/pdfjs/cmaps/CNS2-V.bcmap",
"2e4f70a8afd23a12"
],
[
"./vendor/pdfjs/cmaps/ETHK-B5-H.bcmap",
"d2f10fa519336bc4"
],
[
"./vendor/pdfjs/cmaps/ETHK-B5-V.bcmap",
"1fea3fd0d9f0f679"
],
[
"./vendor/pdfjs/cmaps/ETen-B5-H.bcmap",
"87ee6b3f5bfda5fe"
],
[
"./vendor/pdfjs/cmaps/ETen-B5-V.bcmap",
"47dc0d2c21e3bde3"
],
[
"./vendor/pdfjs/cmaps/ETenms-B5-H.bcmap",
"d5f5a73da4173b7d"
],
[
"./vendor/pdfjs/cmaps/ETenms-B5-V.bcmap",
"18252fca90f472f4"
],
[
"./vendor/pdfjs/cmaps/EUC-H.bcmap",
"f9939cd57fccdc65"
],
[
"./vendor/pdfjs/cmaps/EUC-V.bcmap",
"1283a50a706507c4"
],
[
"./vendor/pdfjs/cmaps/Ext-H.bcmap",
"4000ed4e61a1c668"
],
[
"./vendor/pdfjs/cmaps/Ext-RKSJ-H.bcmap",
"e0d2f0df337660e7"
],
[
"./vendor/pdfjs/cmaps/Ext-RKSJ-V.bcmap",
"f617a22b6d67febb"
],
[
"./vendor/pdfjs/cmaps/Ext-V.bcmap",
"c2087fb845a9e3ac"
],
[
"./vendor/pdfjs/cmaps/GB-EUC-H.bcmap",
"928bad06fd84a48f"
],
[
"./vendor/pdfjs/cmaps/GB-EUC-V.bcmap",
"a9ad88ac2479da52"
],
[
"./vendor/pdfjs/cmaps/GB-H.bcmap",
"1018c777a8910b5b"
],
[
"./vendor/pdfjs/cmaps/GB-V.bcmap",
"0b96789143c0bbf9"
],
[
"./vendor/pdfjs/cmaps/GBK-EUC-H.bcmap",
"2103fed28650ede0"
],
[
"./vendor/pdfjs/cmaps/GBK-EUC-V.bcmap",
"a7fd35dd14d9dbdb"
],
[
"./vendor/pdfjs/cmaps/GBK2K-H.bcmap",
"3d919ae72af16c5c"
],
[
"./vendor/pdfjs/cmaps/GBK2K-V.bcmap",
"b927fdfd595c07ce"
],
[
"./vendor/pdfjs/cmaps/GBKp-EUC-H.bcmap",
"d15ebd8e81fb4fe8"
],
[
"./vendor/pdfjs/cmaps/GBKp-EUC-V.bcmap",
"fdc736d46e642625"
],
[
"./vendor/pdfjs/cmaps/GBT-EUC-H.bcmap",
"dc5f44e48a39f336"
],
[
"./vendor/pdfjs/cmaps/GBT-EUC-V.bcmap",
"a1ad24e63653b8aa"
],
[
"./vendor/pdfjs/cmaps/GBT-H.bcmap",
"8afda745a505763f"
],
[
"./vendor/pdfjs/cmaps/GBT-V.bcmap",
"cdc2ec5c3c7c7033"
],
[
"./vendor/pdfjs/cmaps/GBTpc-EUC-H.bcmap",
"7b23e2f7bfdb6c91"
],
[
"./vendor/pdfjs/cmaps/GBTpc-EUC-V.bcmap",
"d7a1b13ead9ab511"
],
[
"./vendor/pdfjs/cmaps/GBpc-EUC-H.bcmap",
"3c4a4eb82f05abe5"
],
[
"./vendor/pdfjs/cmaps/GBpc-EUC-V.bcmap",
"215bdfa284270562"
],
[
"./vendor/pdfjs/cmaps/H.bcmap",
"a0233e21047ec00b"
],
[
"./vendor/pdfjs/cmaps/HKdla-B5-H.bcmap",
"5242bce18fb13ab4"
],
[
"./vendor/pdfjs/cmaps/HKdla-B5-V.bcmap",
"2e0537f786c0791d"
],
[
"./vendor/pdfjs/cmaps/HKdlb-B5-H.bcmap",
"fdc8159984bf5dbe"
],
[
"./vendor/pdfjs/cmaps/HKdlb-B5-V.bcmap",
"b249eb9dcb915ab4"
],
[
"./vendor/pdfjs/cmaps/HKgccs-B5-H.bcmap",
"ab64c7fc5e9b2e97"
],
[
"./vendor/pdfjs/cmaps/HKgccs-B5-V.bcmap",
"02ebdf7cdffb5395"
],
[
"./vendor/pdfjs/cmaps/HKm314-B5-H.bcmap",
"bfd8bbde6b36a9da"
],
[
"./vendor/pdfjs/cmaps/HKm314-B5-V.bcmap",
"2a64a815cfb6fdd4"
],
[
"./vendor/pdfjs/cmaps/HKm471-B5-H.bcmap",
"49d7c037758826b5"
],
[
"./vendor/pdfjs/cmaps/HKm471-B5-V.bcmap",
"be24c109e78aa4fe"
],
[
"./vendor/pdfjs/cmaps/HKscs-B5-H.bcmap",
"08599378f41d96b4"
],
[
"./vendor/pdfjs/cmaps/HKscs-B5-V.bcmap",
"d073542b7dad1c4c"
],
[
"./vendor/pdfjs/cmaps/Hankaku.bcmap",
"b454701f7aecd785"
],
[
"./vendor/pdfjs/cmaps/Hiragana.bcmap",
"2ed669394756dd94"
],
[
"./vendor/pdfjs/cmaps/KSC-EUC-H.bcmap",
"6784e16dbc5861c0"
],
[
"./vendor/pdfjs/cmaps/KSC-EUC-V.bcmap",
"fdb36bad85e99248"
],
[
"./vendor/pdfjs/cmaps/KSC-H.bcmap",
"c1f6d61f1d3304fd"
],
[
"./vendor/pdfjs/cmaps/KSC-Johab-H.bcmap",
"939993d213f68db7"
],
[
"./vendor/pdfjs/cmaps/KSC-Johab-V.bcmap",
"5d61967aac0e666d"
],
[
"./vendor/pdfjs/cmaps/KSC-V.bcmap",
"d7da5afd9f1fe748"
],
[
"./vendor/pdfjs/cmaps/KSCms-UHC-H.bcmap",
"5b70d8f6a4fa9e22"
],
[
"./vendor/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap",
"a5e6ba22aceb02fd"
],
[
"./vendor/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap",
"890332a6a26880d4"
],
[
"./vendor/pdfjs/cmaps/KSCms-UHC-V.bcmap",
"1631b531c9a40c8c"
],
[
"./vendor/pdfjs/cmaps/KSCpc-EUC-H.bcmap",
"709480682c55cedb"
],
[
"./vendor/pdfjs/cmaps/KSCpc-EUC-V.bcmap",
"031707887d6fc237"
],
[
"./vendor/pdfjs/cmaps/Katakana.bcmap",
"3b6ca6642fbf8822"
],
[
"./vendor/pdfjs/cmaps/NWP-H.bcmap",
"286c6c9e335da330"
],
[
"./vendor/pdfjs/cmaps/NWP-V.bcmap",
"3a75fb7b59adfb17"
],
[
"./vendor/pdfjs/cmaps/RKSJ-H.bcmap",
"a70de61a22a898f6"
],
[
"./vendor/pdfjs/cmaps/RKSJ-V.bcmap",
"68c1a64506471a52"
],
[
"./vendor/pdfjs/cmaps/Roman.bcmap",
"1c6b3ef9d9e5cb1a"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UCS2-H.bcmap",
"779428116752f34e"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UCS2-V.bcmap",
"1e5cc184b850ea44"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UTF16-H.bcmap",
"32ff139b3c7b91d6"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UTF16-V.bcmap",
"278eb1e68d1a236c"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UTF32-H.bcmap",
"bf26eb67fe19ee5b"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UTF32-V.bcmap",
"f7da3caf83ceb1cb"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UTF8-H.bcmap",
"2f2a742bcd1a84a1"
],
[
"./vendor/pdfjs/cmaps/UniCNS-UTF8-V.bcmap",
"b7c3f10780a8c62d"
],
[
"./vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap",
"9201569b402e81ad"
],
[
"./vendor/pdfjs/cmaps/UniGB-UCS2-V.bcmap",
"f10282335e4d6420"
],
[
"./vendor/pdfjs/cmaps/UniGB-UTF16-H.bcmap",
"386fd39581245c03"
],
[
"./vendor/pdfjs/cmaps/UniGB-UTF16-V.bcmap",
"0473cfbba612b92d"
],
[
"./vendor/pdfjs/cmaps/UniGB-UTF32-H.bcmap",
"f48a145dc4e3ed1d"
],
[
"./vendor/pdfjs/cmaps/UniGB-UTF32-V.bcmap",
"106acc49b7118bde"
],
[
"./vendor/pdfjs/cmaps/UniGB-UTF8-H.bcmap",
"f217b439c80ee5fa"
],
[
"./vendor/pdfjs/cmaps/UniGB-UTF8-V.bcmap",
"a64df947632878ea"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap",
"ad2352f40870880f"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap",
"16e87edca954177c"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap",
"1973457e2c019281"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UCS2-V.bcmap",
"42a133d8e2ce9dd6"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UTF16-H.bcmap",
"f6a89c5688978548"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UTF16-V.bcmap",
"c67126fc7c738508"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UTF32-H.bcmap",
"96195950ce0fe244"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UTF32-V.bcmap",
"ed4dafda402bdd19"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UTF8-H.bcmap",
"798fb0bf06ab0788"
],
[
"./vendor/pdfjs/cmaps/UniJIS-UTF8-V.bcmap",
"1021611424f913b2"
],
[
"./vendor/pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap",
"710a32d7cb43fd6b"
],
[
"./vendor/pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap",
"3b149aff5c5707b5"
],
[
"./vendor/pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap",
"8d2658e18741af79"
],
[
"./vendor/pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap",
"6dd475782f289764"
],
[
"./vendor/pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap",
"691c614ce432b3e6"
],
[
"./vendor/pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap",
"40a8c7ea2d46711c"
],
[
"./vendor/pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap",
"6826f94d789d7bf1"
],
[
"./vendor/pdfjs/cmaps/UniJISPro-UCS2-V.bcmap",
"493de9fd1a08f794"
],
[
"./vendor/pdfjs/cmaps/UniJISPro-UTF8-V.bcmap",
"6181d382cf736c5e"
],
[
"./vendor/pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap",
"692044e1fb334456"
],
[
"./vendor/pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap",
"dd54e16ca7bffb3a"
],
[
"./vendor/pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap",
"f80ea5a989be30cc"
],
[
"./vendor/pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap",
"94c22bd99e771c5f"
],
[
"./vendor/pdfjs/cmaps/UniKS-UCS2-H.bcmap",
"a1081396ab4adb6f"
],
[
"./vendor/pdfjs/cmaps/UniKS-UCS2-V.bcmap",
"6cab547431958fbd"
],
[
"./vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap",
"42d35b396286499d"
],
[
"./vendor/pdfjs/cmaps/UniKS-UTF16-V.bcmap",
"5bdb7390c80dcc13"
],
[
"./vendor/pdfjs/cmaps/UniKS-UTF32-H.bcmap",
"3a01ec51ed1b8281"
],
[
"./vendor/pdfjs/cmaps/UniKS-UTF32-V.bcmap",
"dfda895eceaed081"
],
[
"./vendor/pdfjs/cmaps/UniKS-UTF8-H.bcmap",
"3fac9c65145f72d7"
],
[
"./vendor/pdfjs/cmaps/UniKS-UTF8-V.bcmap",
"9ecc6cf30dd354b9"
],
[
"./vendor/pdfjs/cmaps/V.bcmap",
"b9ad1c0c09ff14bc"
],
[
"./vendor/pdfjs/cmaps/WP-Symbol.bcmap",
"543923bead225732"
],
[
"./vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
"845c752392b6c914"
],
[
"./vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
"b6c8fe53f134b8b6"
],
[
"./vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
"f1b7159702973f54"
],
[
"./vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
"8a000945843bd31a"
],
[
"./vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
"5007faf8320fa1fc"
],
[
"./vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
"4f57d2b9d884af8f"
],
[
"./vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
"0bdf4b04e9641398"
],
[
"./vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
"a406cac82583bf98"
],
[
"./vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
"610ae0687198045c"
],
[
"./vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
"47967d055530e735"
],
[
"./vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
"361c61b82d575c5c"
],
[
"./vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
"a224075ac17495ad"
],
[
"./vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
"832b4406dbef2362"
],
[
"./vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
"f8ace1f892b2bd9d"
],
[
"./vendor/pdfjs/wasm/jbig2.wasm",
"466f45c2a61a6981"
],
[
"./vendor/pdfjs/wasm/openjpeg.wasm",
"7ea4b2b04613370a"
],
[
"./vendor/pdfjs/wasm/qcms_bg.wasm",
"663d86126d5f5fcb"
],
[
"./vendor/tesseract/tesseract.min.js",
"000c27d9cd0def65"
],
[
"./vendor/tesseract/worker.min.js",
"fc2c42c739aefe6e"
]
];
// 문자인식 엔진처럼 큰 파일: 처음 쓸 때(또는 ‘미리 받기’) 받아서 보관한다. [경로, 허용하는 해시 목록]
const OPTIONAL = [
[
"./vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
[
"c58b46a4c796c0b8"
]
],
[
"./vendor/tesseract/tesseract-core-lstm.wasm.js",
[
"eef5f8b2f8e20e15"
]
],
[
"./vendor/tesseract/lang/kor.traineddata.gz",
[
"78c21276ab14c9bb",
"ec1749377d49ac38"
]
],
[
"./vendor/tesseract/lang/eng.traineddata.gz",
[
"45b4cb346724ac17",
"5dc5d8d640a212c9"
]
]
];
const HASH = new Map(FILES.map(([p, h]) => [new URL(p, self.location.href).pathname, h]));
const OPT_HASH = new Map(OPTIONAL.map(([p, h]) => [new URL(p, self.location.href).pathname, h]));

/** 합성 응답에는 형식만 남긴다(압축·길이 머리글이 실제 내용과 어긋나지 않게) */
function plainHeaders(h) {
  return { 'Content-Type': (h && h.get('content-type')) || 'application/octet-stream' };
}

async function sha16(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}

// 새 버전 설치: 내용이 같은 파일은 기기에 있던 것을 옮기고, 바뀐 파일만 받는다.
// 받은 파일의 내용(해시)도 확인해, 서버에 아직 옛 파일이 남아 있으면 설치를 미루고 다음에 다시 시도한다.
// 문자인식 엔진은 이미 받아 둔 것만 새 보관함으로 옮긴다(새로 받지는 않는다).
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const oldNames = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE);
    const olds = await Promise.all(oldNames.map((k) => caches.open(k)));
    // hash: 해시 하나 또는 허용하는 해시 목록
    const ok = (h, hash) => (Array.isArray(hash) ? hash.includes(h) : h === hash);
    async function reuse(path, hash) {
      const have = await cache.match(path);
      if (have && ok(await sha16(await have.arrayBuffer()), hash)) return true;   // 지난번에 받다 끊긴 경우 이어 받기
      for (const oc of olds) {
        const r = await oc.match(path);
        if (!r) continue;
        const buf = await r.arrayBuffer();
        if (ok(await sha16(buf), hash)) {
          await cache.put(path, new Response(buf, { headers: plainHeaders(r.headers) }));
          return true;
        }
      }
      return false;
    }
    let next = 0;
    async function worker() {
      while (next < FILES.length) {
        const [path, hash] = FILES[next++];
        if (await reuse(path, hash)) continue;
        const res = await fetch(new Request(path, { cache: 'reload' }));
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
        const buf = await res.clone().arrayBuffer();
        if (await sha16(buf) !== hash) throw new Error('아직 옛 파일: ' + path);
        await cache.put(path, res);
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    for (const [path, hash] of OPTIONAL) {
      try { await reuse(path, hash); } catch (e) { /* 다음에 쓸 때 받는다 */ }
    }
    await self.skipWaiting();
  })());
});

// 보관함이 비었을 때(같은 주소의 다른 앱이나 기기가 정리한 경우) 인터넷이 되면 이 버전의 파일로 다시 채운다.
let healing = null;
function heal() {
  if (!healing) {
    healing = (async () => {
      const cache = await caches.open(CACHE);
      for (const [path, hash] of FILES) {
        if (await cache.match(path)) continue;
        let res;
        try { res = await fetch(new Request(path, { cache: 'reload' })); } catch (e) { return; }
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (await sha16(buf) === hash) await cache.put(path, new Response(buf, { headers: plainHeaders(res.headers) }));
      }
    })().catch(() => {}).finally(() => { healing = null; });
  }
  return healing;
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 이 앱의 옛 버전 보관함만 지운다(같은 주소의 다른 앱 보관함은 건드리지 않는다)
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** 큰 선택 파일: 보관함에 없으면 이 앱 주소에서 받아, 내용이 맞을 때만 보관한다. hashes: 허용하는 해시 목록 */
async function optionalFile(req, hashes) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(new Request(req.url, { cache: 'reload' }));
  if (!res.ok) return res;
  const buf = await res.arrayBuffer();
  const out = new Response(buf, { status: 200, headers: plainHeaders(res.headers) });
  if (hashes.includes(await sha16(buf))) await cache.put(new URL(req.url).pathname, out.clone());
  return out;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (OPT_HASH.has(url.pathname)) {
    event.respondWith(optionalFile(req, OPT_HASH.get(url.pathname)).catch(() =>
      new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    try {
      const res = await fetch(req);
      if (res.ok && HASH.has(url.pathname)) {
        try { event.waitUntil(heal()); } catch (e) { heal(); }
      }
      return res;
    } catch (e) {
      return new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

// 다른 앱에서 ‘공유 → PDF→TXT’로 보낸 PDF를 기기 안 임시 보관함에 넣고 앱을 연다 (Android)
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('pdf').filter((f) => f && typeof f === 'object' && f.size > 0);
    const cache = await caches.open(SHARE_CACHE);
    let i = 0;
    for (const f of files) {
      await cache.put(
        new Request('./__shared__/' + Date.now() + '-' + (i++)),
        new Response(f, { headers: { 'Content-Type': 'application/pdf', 'X-Name': encodeURIComponent(f.name || 'shared.pdf') } })
      );
    }
  } catch (e) { /* 받지 못하면 그냥 앱을 연다 */ }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
}
