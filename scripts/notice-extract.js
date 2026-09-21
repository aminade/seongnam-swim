/**
 * 공지 글 → 평문 텍스트 (전부 로컬, 무료). AI 해석 전에 여기서 글자를 다 뽑아 둔다.
 *
 *  - 본문 HTML → 텍스트
 *  - PDF       → 글자 추출(doc_tools.py). 스캔본이라 글자가 없으면 페이지를 PNG로 → OCR
 *  - 이미지     → macOS Vision OCR(ocr.swift, 온디바이스·오프라인). 첨부 + 본문에 박힌 이미지 모두
 *  - HWP       → pyhwp hwp5html(표 안 글자까지). 같은 이름의 PDF가 있으면 PDF만 읽는다
 *  - HWPX      → zip 안 XML(doc_tools.py)
 *
 * 필요 도구(맥 러너): python3 + pypdfium2·pdfplumber·pyhwp, Xcode CLT(swiftc). 없으면 그 형식만 건너뛰고
 * 결과의 skipped 에 이유를 남긴다(전체는 안 깨짐).
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { htmlToText } from './notice-sources.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DOC_TOOLS = join(__dir, 'doc_tools.py');
const OCR_SRC = join(__dir, 'ocr.swift');
const CACHE_DIR = join(homedir(), '.swim-notice');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, timeout: 180000, ...opts });

// OCR 바이너리: 소스 해시별로 한 번만 컴파일해 캐시(매번 swift 인터프리터로 돌리면 50초+).
let ocrBin;
function ocrBinary() {
  if (ocrBin !== undefined) return ocrBin;
  ocrBin = null;
  try {
    const h = createHash('sha1').update(readFileSync(OCR_SRC)).digest('hex').slice(0, 10);
    const bin = join(CACHE_DIR, `ocr-${h}`);
    if (!existsSync(bin)) {
      mkdirSync(CACHE_DIR, { recursive: true });
      const r = run('swiftc', ['-O', OCR_SRC, '-o', bin], { timeout: 300000 });
      if (r.status !== 0) { console.log(`  (OCR 컴파일 실패: ${(r.stderr || '').slice(0, 200)})`); return null; }
    }
    ocrBin = bin;
  } catch (e) { console.log(`  (OCR 준비 실패: ${e.message})`); }
  return ocrBin;
}
function ocrFile(path) {
  const bin = ocrBinary();
  if (!bin) return null;
  const r = run(bin, [path]);
  return r.status === 0 ? r.stdout : null;
}

// pyhwp 실행파일: PATH에 없으면 사용자 site(pip --user) bin 에서 찾는다.
function hwp5html() {
  const which = run('which', ['hwp5html']);
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const base = join(homedir(), 'Library', 'Python');
  try {
    for (const v of readdirSync(base)) {
      const p = join(base, v, 'bin', 'hwp5html');
      if (existsSync(p)) return p;
    }
  } catch { /* 없음 */ }
  return null;
}

const meaningful = t => (t || '').replace(/\s+/g, '').length;
const stem = name => String(name).replace(/\.[^.]+$/, '').replace(/\s+/g, '');

// post → { text, parts:[{from, chars}], skipped:[{name, reason}] }
export async function extractPostText(post) {
  const work = mkdtempSync(join(tmpdir(), 'notice-'));
  const parts = [];
  const skipped = [];
  const add = (from, text) => { if (meaningful(text)) parts.push({ from, text: text.trim() }); };
  try {
    add('본문', htmlToText(post.bodyHtml));

    const pdfStems = new Set(post.attachments.filter(a => a.ext === 'pdf').map(a => stem(a.name)));
    let n = 0;
    for (const a of post.attachments) {
      const p = join(work, `a${n++}.${a.ext || 'bin'}`);
      // 같은 이름의 PDF가 있으면 HWP·이미지는 같은 내용이라 건너뛴다(탄천: 안내문.hwp/.jpg/.pdf 3종 동시 게시).
      if (a.ext !== 'pdf' && pdfStems.has(stem(a.name))) { skipped.push({ name: a.name, reason: '같은 내용 PDF로 대체' }); continue; }
      if (!['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'hwp', 'hwpx'].includes(a.ext)) { skipped.push({ name: a.name, reason: `읽지 않는 형식(${a.ext})` }); continue; }
      const buf = await a.load();
      if (!buf) { skipped.push({ name: a.name, reason: '다운로드 실패' }); continue; }
      writeFileSync(p, buf);

      if (a.ext === 'pdf') {
        const r = run('python3', [DOC_TOOLS, 'pdf-text', p]);
        if (r.status === 0 && meaningful(r.stdout) > 40) { add(a.name, r.stdout); continue; }
        // 스캔 PDF: 페이지 이미지로 렌더 → OCR
        const rr = run('python3', [DOC_TOOLS, 'pdf-render', p, join(work, `r${n}`)]);
        const pages = (rr.stdout || '').split('\n').filter(Boolean);
        const ocr = pages.map(ocrFile).filter(Boolean).join('\n');
        if (meaningful(ocr)) add(`${a.name} (OCR)`, ocr);
        else skipped.push({ name: a.name, reason: 'PDF 글자·OCR 모두 실패' });
      } else if (a.ext === 'hwpx') {
        const r = run('python3', [DOC_TOOLS, 'hwpx-text', p]);
        if (meaningful(r.stdout)) add(a.name, r.stdout); else skipped.push({ name: a.name, reason: 'HWPX 읽기 실패' });
      } else if (a.ext === 'hwp') {
        const bin = hwp5html();
        if (!bin) { skipped.push({ name: a.name, reason: 'pyhwp 미설치' }); continue; }
        const out = join(work, `h${n}`);
        const r = run(bin, ['--output', out, p]);
        const x = join(out, 'index.xhtml');
        if (r.status === 0 && existsSync(x)) add(a.name, htmlToText(readFileSync(x, 'utf-8')));
        else skipped.push({ name: a.name, reason: 'HWP 읽기 실패' });
      } else {
        const t = ocrFile(p);
        if (meaningful(t)) add(`${a.name} (OCR)`, t); else skipped.push({ name: a.name, reason: '이미지 OCR 실패' });
      }
    }

    // 본문에 박힌 이미지(금곡처럼 첨부 없이 이미지로만 올리는 경우). 작은 장식 이미지는 건너뛴다.
    let k = 0;
    for (const im of post.images) {
      const buf = await im.load();
      if (!buf || buf.length < 8 * 1024) continue;
      const p = join(work, `i${k++}.img`);
      writeFileSync(p, buf);
      const t = ocrFile(p);
      if (meaningful(t)) add(`본문 이미지 ${k} (OCR)`, t);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const text = parts.map(p => `[${p.from}]\n${p.text}`).join('\n\n');
  return { text, parts: parts.map(p => ({ from: p.from, chars: p.text.length })), skipped };
}
