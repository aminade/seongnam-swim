#!/usr/bin/env node
/**
 * 확정된 수영장 운영 변경사항 한 건을 SEO 시트 '수영장 운영 변경사항' 탭에 기록(append).
 * monthly-todo-proxy.gs 의 doPost로 전송. env SEO_CHANGES_CSV_URL(= …/exec?token=) 필요.
 *
 * 대상월(공지할 시점) 규칙:
 *   - 적용월이 미래면  → 대상월 = 적용월   (예: 발견 7/18·적용 9/1 → 2026-09)
 *   - 이미 반영됐으면 → 대상월 = 다음 달  (예: 발견 7/14·적용 7/14 → 2026-08)
 *   - --month 로 명시하면 그 값을 그대로 사용.
 *
 * 모듈:  import { appendChange, computeTargetMonth } from './change-log.js'
 *        await appendChange({ text, disc, eff, month })  // month 생략 시 자동
 * CLI:   node scripts/change-log.js "성남 자유수영 3,600→4,000원 인상" --disc 7/14 --eff 7/14 [--month 2026-08]
 */

import { fileURLToPath } from 'url';

const pad = n => String(n).padStart(2, '0');

// eff("2026-09-01" | "9/1" | "2026-09") → {ey, em}. 파싱 불가 시 현재 연·월.
function parseEff(eff, cy, cm) {
  const s = String(eff ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})\D+(\d{1,2})(?:\D+\d{1,2})?$/))) return { ey: +m[1], em: +m[2] };
  if ((m = s.match(/^(\d{1,2})\D+(\d{1,2})$/))) return { ey: cy, em: +m[1] };
  return { ey: cy, em: cm };
}

export function computeTargetMonth(eff, now = Date.now()) {
  const kst = new Date(now + 9 * 3600 * 1000);
  const cy = kst.getUTCFullYear(), cm = kst.getUTCMonth() + 1;
  const { ey, em } = parseEff(eff, cy, cm);
  if (ey > cy || (ey === cy && em > cm)) return `${ey}-${pad(em)}`; // 미래 → 적용월
  let ny = cy, nm = cm + 1; if (nm > 12) { nm = 1; ny++; }          // 이미 반영 → 다음 달
  return `${ny}-${pad(nm)}`;
}

export async function appendChange({ text, disc = '', eff = '', month, now } = {}) {
  const url = process.env.SEO_CHANGES_CSV_URL;
  if (!url) return { ok: false, error: 'SEO_CHANGES_CSV_URL 미설정' };
  if (!text || !String(text).trim()) return { ok: false, error: 'text 필요' };
  const m = month || computeTargetMonth(eff, now);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: m, disc, eff, text }),
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { return { ok: false, error: t.slice(0, 140) }; }
  return { ...j, month: m };
}

// ── CLI ──
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[++i]; }
    else out._.push(a);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = parseArgs(process.argv.slice(2));
  const text = a._.join(' ').trim();
  if (!text) { console.error('내용(text)이 필요합니다. 예: node scripts/change-log.js "성남 요금 인상" --eff 7/14'); process.exit(1); }
  const r = await appendChange({ text, disc: a.disc || '', eff: a.eff || '', month: a.month });
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
