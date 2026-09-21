#!/usr/bin/env node
/**
 * 점검 결과를 텔레그램으로 발송.
 * - /tmp/notice-check.json (공지 감시 + 공휴일 리마인더 + 말일 TO-DO)
 * - /tmp/schedule-changes.json (기존 program-guide 크롤 결과, 있으면 함께 요약)
 *
 * 인자: node notify-telegram.js [issueNumber]
 *   issueNumber가 주어지면 자동반영 후보에 [✅ 반영][❌ 무시] 인라인 버튼을 붙인다.
 *   버튼 callback_data: "confirm:<issue>" / "reject:<issue>" (Cloudflare Worker가 처리).
 *
 * 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (필수)
 */

import { readFileSync, existsSync } from 'fs';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DRY_RUN = process.env.DRY_RUN === '1'; // 실제 발송 없이 메시지를 콘솔에 출력(테스트용)
if (!DRY_RUN && (!TOKEN || !CHAT_ID)) { console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 필요'); process.exit(1); }

const readJson = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); // HTML escape
const b = s => `<b>${esc(s)}</b>`;
const i = s => `<i>${esc(s)}</i>`;

// 직전 실행에서 며칠이 비었는지. 맥(자기호스팅 러너)이 24시간 넘게 꺼져 있으면 GitHub이
// 대기 중인 실행을 취소해 그날 점검이 통째로 누락되므로, 복귀 후 첫 알림에서 알려준다.
function missedDays() {
  const prev = process.env.PREV_RUN_AT;
  if (!prev) return 0;
  const gapMs = Date.now() - new Date(prev).getTime();
  if (!Number.isFinite(gapMs) || gapMs <= 48 * 3600 * 1000) return 0;
  return Math.floor(gapMs / (24 * 3600 * 1000));
}

function buildMessage() {
  const nc = readJson('/tmp/notice-check.json');
  const sc = readJson('/tmp/schedule-changes.json');
  const L = [];
  const label = nc?.target?.label || '';
  const runLabel = nc?.target?.runLabel || label;
  L.push(`🏊 ${b(`성남 수영장 점검 — ${runLabel}`)}`);

  const missed = missedDays();
  if (missed) {
    L.push('');
    L.push(`⚠️ ${b(`마지막 점검 이후 ${missed}일`)} — 그 사이 올라온 공지를 놓쳤을 수 있습니다.`);
  }

  // ── 프로그램 시간표 변경(기존 크롤) ──
  const changed = sc?.changed || [];
  const youthChanged = sc?.youthChanged || [];
  if (changed.length || youthChanged.length) {
    L.push('');
    L.push(`⚠️ ${b('시간표 변경 감지')}`);
    for (const r of [...changed, ...youthChanged]) {
      L.push(`• ${b(r.pool)}`);
      for (const c of r.changes) L.push(`   ↳ ${esc(c.desc)}`);
    }
  }

  // ── 공지 감시 (모든 게시판 새 글·수정 글 → 로컬 추출 → AI 해석 → 사이트 대조) ──
  const w = nc?.watch || { fresh: [], pending: [], needsImpl: [], manual: [], errors: [] };
  const link = (e) => `<a href="${esc(e.url)}">공지 보기</a>`;
  const head = (e) => `• ${b(e.poolName)} 「${esc(e.title)}」${e.edited ? i(' (수정됨)') : ''} — ${link(e)}`;
  if (w.fresh.length) {
    L.push('');
    L.push(`📢 ${b('새 공지 — 사이트 반영 필요')}`);
    for (const f of w.fresh) {
      L.push(head(f));
      for (const it of f.items) L.push(`   ↳ ${esc(it.text)}`);
    }
    L.push(i('맞으면 알려주세요. 사이트에 반영합니다.'));
  }
  if (w.needsImpl.length) {
    L.push('');
    L.push(`🛠 ${b('새 구현 필요 — 지금 사이트 구조로 표현 못 함')}`);
    for (const n of w.needsImpl) { L.push(head(n)); L.push(`   ↳ ${esc(n.description)}`); }
  }
  if (w.pending.length) {
    L.push('');
    L.push(`⏳ ${b('이전에 알린 공지 — 아직 사이트 미반영')}`);
    for (const f of w.pending) { L.push(head(f)); for (const it of f.items) L.push(`   ↳ ${esc(it.text)}`); }
  }
  // AI 키가 없어 해석 못 한 글은 한 줄로(첫 실행엔 수십 건이라 목록으로 보내면 폭탄이 된다).
  const noKey = w.manual.filter(m => m.reason.startsWith('AI 키 미설정'));
  const manual = w.manual.filter(m => !m.reason.startsWith('AI 키 미설정'));
  if (noKey.length) {
    L.push('');
    L.push(`🔑 ${b('AI 키 미설정')} — 운영 관련 새 글 ${noKey.length}건을 해석하지 못했어요. 키 등록 후 다음 실행에서 자동으로 다시 읽어요.`);
  }
  if (manual.length) {
    L.push('');
    L.push(`🔎 ${b('직접 확인 필요')}`);
    for (const m of manual) { L.push(head(m)); L.push(`   ↳ ${esc(m.reason)}`); }
  }
  if (w.error) { L.push(''); L.push(`⚠️ 공지 감시 오류: ${esc(w.error)}`); }

  const isMonthly = !!nc?.target?.isFirstOfMonth;
  const hi = nc?.holidayInfo;

  // ── 이 달 공휴일 리마인더 (월초 다이제스트에만) ──
  if (isMonthly && hi?.official?.length) {
    L.push('');
    L.push(`📅 ${b(`${label} 공휴일 — 확인 필요`)}`);
    for (const h of hi.official) L.push(`• ${esc(h.date.slice(5))} ${esc(h.name)}`);
  }
  // ── 우리 데이터 누락 공휴일 (오류 알림 — 항상) ──
  if (hi?.missing?.length) {
    L.push('');
    L.push(`🚨 ${b('우리 데이터에 빠진 공휴일')}`);
    for (const h of hi.missing) L.push(`• ${esc(h.date)} ${esc(h.name)} ← HOLIDAYS 추가 필요`);
  }

  // 크롤 실패: 같은 수영장이 시간표·공지 두 단계에서 모두 실패할 수 있으므로 이름으로 묶어
  // 한 번만 출력하고, 어느 단계가 깨졌는지 라벨로 밝힌다.
  const failStages = new Map(); // pool → Set<'시간표'|'공지'>
  const addFails = (rows, stage) => {
    for (const r of rows || []) {
      if (!failStages.has(r.pool)) failStages.set(r.pool, new Set());
      failStages.get(r.pool).add(stage);
    }
  };
  addFails(sc?.errors, '시간표');
  addFails(sc?.youthErrors, '시간표');
  addFails(w.errors, '공지');
  const errs = [...failStages].map(([pool, stages]) => `${pool}(${[...stages].join('·')})`);

  const anyAlert = !!(changed.length || youthChanged.length || w.fresh.length || w.pending.length || w.needsImpl.length || w.manual.length || w.error || hi?.missing?.length || errs.length || missed);

  // ── 이상 없음 (월초 다이제스트에서만 표기; 알림만 모드에선 애초에 발송 안 함) ──
  if (isMonthly && !anyAlert) { L.push(''); L.push('✅ 시간표·공지 이상 없음'); }

  if (errs.length) { L.push(''); L.push(`⚠️ 크롤 실패: ${esc(errs.join(', '))}`); }

  return { lines: L, changed, anyAlert, isMonthly };
}

// 매월 말일 배치가 만든 다음 달 1일 TO-DO(수영장 영업 변경사항 + 이전 달 SEO 성과 기록).
// 평소 점검 다이제스트와 성격이 달라 별도 메시지로 보낸다. 말일이 아니면 nc.monthlyTodo=null.
function buildTodoLines() {
  const nc = readJson('/tmp/notice-check.json');
  const t = nc?.monthlyTodo;
  if (!t) return null;

  const fmtDates = (disc, eff) => {
    if (disc && eff && disc !== eff) return ` (발견 ${esc(disc)} · 적용 ${esc(eff)})`;
    const only = eff || disc;
    return only ? ` (${esc(only)})` : '';
  };

  const L = [];
  L.push(`✅ ${b(`${t.comingLabel} TO-DO`)}`);
  L.push('수영장 영업 변경사항');
  if (t.changes?.length) {
    for (const c of t.changes) L.push(`• ${esc(c.text)}${fmtDates(c.disc, c.eff)}`);
  } else if (t.error && t.error !== 'CSV 미설정') {
    L.push(i(`변경사항 목록을 불러오지 못했습니다 (${t.error})`));
  } else if (t.error === 'CSV 미설정') {
    L.push(i('변경사항 시트(웹 게시 CSV) 아직 미연동 — 설정 후 자동 표기됩니다'));
  } else {
    L.push('• 변경사항 없음');
  }
  L.push('');
  L.push(`${t.seoMonthLabel} SEO 성과 기록`);
  if (t.seoDocUrl) L.push(esc(t.seoDocUrl));
  return L;
}

async function send(text, replyMarkup) {
  if (DRY_RUN) { console.log('\n──────── DRY_RUN 메시지 ────────\n' + text + '\n────────────────────────────'); return { ok: true }; }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID, text, parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Telegram 발송 실패: ${JSON.stringify(j)}`);
  return j;
}

async function main() {
  const issue = process.argv[2];                 // GitHub 이슈 번호(자동반영 후보 있을 때만)
  const repo = process.env.GITHUB_REPOSITORY;    // "owner/repo" (Actions에서 주입)
  const { lines, changed, anyAlert, isMonthly } = buildMessage();

  // 매월 말일: 다음 달 1일 TO-DO는 별도 메시지로 항상 발송(점검 다이제스트 발송 여부와 무관).
  const todoLines = buildTodoLines();

  // 알림만 모드: 월초(1일) 다이제스트가 아니고 알릴 것도 없으면 점검 메시지는 생략(매일 실행 스팸 방지).
  // 단, 말일 TO-DO가 있으면 그것만은 보내야 하므로 조기 return 하지 않는다.
  if (!isMonthly && !anyAlert && !todoLines) { console.log('알림 없음(비월초) — 발송 건너뜀'); return; }

  // 자동반영 가능한 항목이 있으면: 범위를 분명히 표시 + GitHub 이슈 링크로 /confirm 유도 (A안)
  if (issue && changed.length > 0) {
    lines.push('');
    lines.push('────────────');
    lines.push(`${b('자동 반영 가능 — 아래 항목만')}`);
    for (const r of changed) for (const c of r.changes) lines.push(`   • ${esc(r.pool)}: ${esc(c.desc)}`);
    const url = repo ? `https://github.com/${repo}/issues/${issue}` : null;
    if (url) lines.push(`👉 반영하려면 <a href="${esc(url)}">이 이슈</a>에서 <code>/confirm</code> 댓글 (오탐이면 <code>/reject</code>)`);
    lines.push(i('공지·공휴일 항목은 자동 반영되지 않습니다(수동).'));
  }

  // 점검 다이제스트: 월초(1일)거나 알릴 것이 있을 때만. (말일에 이것 없이 TO-DO만 갈 수 있음)
  if (isMonthly || anyAlert) {
    await send(lines.join('\n'));
    console.log('텔레그램 발송 완료(점검)');
  }

  // 말일 TO-DO: 별도 메시지
  if (todoLines) {
    await send(todoLines.join('\n'));
    console.log('텔레그램 발송 완료(TO-DO)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
