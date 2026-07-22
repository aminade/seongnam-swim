#!/usr/bin/env node
/**
 * 매월 '말일'(예: 7/31) 밤 배치에서 다음 달 1일용 TO-DO 알림 데이터를 만든다.
 *
 * 왜 말일이냐: 배치는 매일 21시대(KST)에 돈다. 8/1 아침에 확인하려면 8/1 밤 실행은 늦으므로
 *  7/31 밤 실행에 "8/1 TO-DO"를 실어 보낸다.
 *
 * 변경사항 출처: SEO 구글시트의 '변경사항' 탭을 '웹에 게시(CSV)'한 URL(data/monthly-todo.json
 *  또는 env SEO_CHANGES_CSV_URL). 탭 헤더 = 대상월 | 발견일 | 적용일 | 내용.
 *   - 대상월: 어느 달 1일 TO-DO에 넣을지(예: 2026-08). 7월 중 오른 요금 → 2026-08,
 *             7월에 발견했지만 9월부터 바뀌는 사항 → 2026-09.
 *   - 발견일/적용일: 다르면 둘 다 표기("발견 7/18 · 적용 9/1"), 같으면 하나만("7/14").
 *
 * buildMonthlyTodo({ now, csvUrl, seoDocUrl }) → null | {
 *   comingKey, comingLabel, seoMonthLabel, seoDocUrl,
 *   changes: [{ text, disc, eff }], error
 * }
 *  - 말일이 아니면 null(알림 안 만듦). MONTHLY_TODO_FORCE=1 이면 날짜 무시하고 강제 생성(테스트용).
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dir, '..', 'data', 'monthly-todo.json');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');

// KST 벽시계(Actions는 UTC로 돎). Date에 +9h 후 getUTC*로 읽는다.
function kstNow(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000);
}

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch { /* 무시하고 기본값 */ }
  return {};
}

// "2026-09-01" / "2026.9.1" → "9/1", "7/14" → "7/14" (그대로). 빈 값 → ''.
function shortDate(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const ymd = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (ymd) return `${+ymd[2]}/${+ymd[3]}`;
  const md = t.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (md) return `${+md[1]}/${+md[2]}`;
  return t; // 알 수 없는 형식은 사용자 입력 그대로
}

// "2026-08" / "2026.8" / "2026년 8월" → "2026-08". 파싱 불가 → null.
function monthKey(s) {
  const m = String(s ?? '').match(/(\d{4})\D+(\d{1,2})/);
  if (!m) return null;
  const mm = +m[2];
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}-${pad(mm)}`;
}

// RFC4180 최소 파서(따옴표 안의 쉼표/개행/이중따옴표 처리). → 행 배열의 배열.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 헤더 이름으로 열 위치를 잡는다(순서 바뀌어도 동작). → {month, disc, eff, text}
function mapColumns(header) {
  const idx = { month: -1, disc: -1, eff: -1, text: -1 };
  header.forEach((h, i) => {
    const t = String(h).replace(/\s+/g, '');
    if (idx.month < 0 && /대상월|^월/.test(t)) idx.month = i;
    else if (idx.disc < 0 && /발견/.test(t)) idx.disc = i;
    else if (idx.eff < 0 && /(적용|변경일|변경날)/.test(t)) idx.eff = i;
    else if (idx.text < 0 && /(내용|변경사항|사항|항목)/.test(t)) idx.text = i;
  });
  return idx;
}

async function fetchCsvRows(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) monthly-todo/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // 게시 안 됐거나 접근 불가면 구글이 HTML(로그인 페이지)을 돌려준다 → CSV 아님
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new Error('CSV 아님(시트 웹 게시 여부 확인 필요)');
  return parseCsv(text);
}

// coming = 다음 달(대상월). rows에서 대상월이 일치하는 항목만 추린다.
function selectChanges(rows, comingKey) {
  if (!rows.length) return [];
  const idx = mapColumns(rows[0]);
  if (idx.month < 0 || idx.text < 0) throw new Error('헤더에 대상월/내용 열이 없음');
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const key = monthKey(cells[idx.month]);
    const text = String(cells[idx.text] ?? '').trim();
    if (!text || key !== comingKey) continue;
    out.push({
      text,
      disc: idx.disc >= 0 ? shortDate(cells[idx.disc]) : '',
      eff: idx.eff >= 0 ? shortDate(cells[idx.eff]) : '',
    });
  }
  return out;
}

export async function buildMonthlyTodo(opts = {}) {
  const cfg = loadConfig();
  const now = opts.now ?? Date.now();
  const csvUrl = opts.csvUrl || process.env.SEO_CHANGES_CSV_URL || cfg.changesCsvUrl || '';
  const seoDocUrl = opts.seoDocUrl || cfg.seoDocUrl || '';

  const kst = kstNow(now);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1, d = kst.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 이번 달 말일
  const force = process.env.MONTHLY_TODO_FORCE === '1' || opts.force;
  if (d !== lastDay && !force) return null; // 말일에만 생성

  // 다음 달 1일(= 내일). 말일이므로 +1일이면 다음 달 1일.
  const coming = kstNow(now + 24 * 3600 * 1000);
  const cy = coming.getUTCFullYear(), cm = coming.getUTCMonth() + 1, cd = coming.getUTCDate();
  const comingKey = `${cy}-${pad(cm)}`;
  const comingLabel = `${cm}/${cd}(${DOW[coming.getUTCDay()]})`; // 예: 8/1(토)
  const seoMonthLabel = `${m}월`; // 끝나는(이전) 달 — SEO 성과 기록 대상

  let changes = [], error = null;
  if (csvUrl) {
    try {
      const rows = await fetchCsvRows(csvUrl);
      changes = selectChanges(rows, comingKey);
    } catch (e) { error = e.message; }
  } else {
    error = 'CSV 미설정'; // 시트 웹 게시 URL 아직 미입력
  }

  return { comingKey, comingLabel, seoMonthLabel, seoDocUrl, changes, error };
}

// 단독 실행: 결과를 JSON으로 출력(디버그). 경로에 공백이 있으면 url 인코딩이 달라지므로
// fileURLToPath로 디코딩해 비교한다.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildMonthlyTodo({ force: true }).then(r => console.log(JSON.stringify(r, null, 2)));
}
