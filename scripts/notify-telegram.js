#!/usr/bin/env node
/**
 * 점검 결과를 텔레그램으로 발송.
 * - /tmp/notice-check.json (공지 비교 + 공휴일 리마인더)
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
if (!TOKEN || !CHAT_ID) { console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 필요'); process.exit(1); }

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

  // ── 공지 게시판 비교 ──
  const diffs = (nc?.noticeResults || []).filter(r => r.status === 'diff');
  if (diffs.length) {
    L.push('');
    L.push(`⚠️ ${b('공식 공지 ↔ 우리 사이트 불일치')}`);
    L.push(i('공식=spo.isdc.co.kr 공지 · 우리=swim.andlife.app'));
    for (const r of diffs) {
      L.push(`• ${b(r.pool)}`);
      if (r.onlyNotice?.length) L.push(`   ↳ ${esc(r.onlyNotice.map(d => `${d.day}일(${d.reason})`).join(', '))}: 공식=휴장 → 우리 사이트는 운영 중`);
      if (r.onlyOurs?.length)  L.push(`   ↳ ${esc(r.onlyOurs.map(d => `${d.day}일(${d.reason})`).join(', '))}: 우리 사이트=휴관 → 공식 공지엔 없음`);
    }
  }

  // ── 임시휴장 공지 (즉시 · 첨부 HWP라 날짜 자동추출 불가 → "떴음"만 알림) ──
  const temps = nc?.tempClosures || [];
  if (temps.length) {
    L.push('');
    L.push(`🆕 ${b('임시휴장 공지 떴음 — 첨부 확인 필요')}`);
    for (const t of temps) {
      L.push(`• ${b(t.pool)} (${esc(t.postedAt)})`);
      L.push(`   ↳ 날짜는 첨부에 있음: <a href="${esc(t.url)}">공지 보기</a>${t.file ? ` · ${esc(t.file)}` : ''}`);
    }
    L.push(i('날짜 확인 후 알려주시면 사이트에 반영합니다.'));
  }

  // ── 25일 묶음: 이미지/HWP 시설 다음 달 휴장 공지 (한 번에 확인) ──
  const batch = nc?.monthlyBatch || [];
  if (batch.length) {
    L.push('');
    L.push(`📌 ${b(`${label} 휴장 공지 확인 필요`)}`);
    for (const m of batch) {
      if (m.missing) L.push(`• ${b(m.pool)}: 아직 미게시 — <a href="${esc(m.url)}">게시판</a>`);
      else L.push(`• ${b(m.pool)}: <a href="${esc(m.url)}">공지 보기</a>${m.file ? ` · ${esc(m.file)}` : ''}`);
    }
    L.push(i('이미지/HWP라 자동 파싱 불가 — 열어 확인 후 알려주시면 반영합니다.'));
  }

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
  addFails((nc?.noticeResults || []).filter(r => r.status === 'error'), '공지');
  const errs = [...failStages].map(([pool, stages]) => `${pool}(${[...stages].join('·')})`);

  const anyAlert = !!(changed.length || youthChanged.length || diffs.length || temps.length || batch.length || hi?.missing?.length || errs.length || missed);

  // ── 이상 없음 (월초 다이제스트에서만 표기; 알림만 모드에선 애초에 발송 안 함) ──
  if (isMonthly && !anyAlert) { L.push(''); L.push('✅ 시간표·공지 이상 없음'); }

  if (errs.length) { L.push(''); L.push(`⚠️ 크롤 실패: ${esc(errs.join(', '))}`); }

  return { lines: L, changed, anyAlert, isMonthly };
}

async function send(text, replyMarkup) {
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

  // 알림만 모드: 월초(1일) 다이제스트가 아니고 알릴 것도 없으면 발송 생략(매일 실행 스팸 방지)
  if (!isMonthly && !anyAlert) { console.log('알림 없음(비월초) — 발송 건너뜀'); return; }

  // 자동반영 가능한 항목이 있으면: 범위를 분명히 표시 + GitHub 이슈 링크로 /confirm 유도 (A안)
  if (issue && changed.length > 0) {
    lines.push('');
    lines.push('────────────');
    lines.push(`${b('자동 반영 가능 — 아래 항목만')}`);
    for (const r of changed) for (const c of r.changes) lines.push(`   • ${esc(r.pool)}: ${esc(c.desc)}`);
    const url = repo ? `https://github.com/${repo}/issues/${issue}` : null;
    if (url) lines.push(`👉 반영하려면 <a href="${esc(url)}">이 이슈</a>에서 <code>/confirm</code> 댓글 (오탐이면 <code>/reject</code>)`);
    lines.push(i('공지 차이·공휴일 확인 항목은 자동 반영되지 않습니다(수동).'));
  }

  await send(lines.join('\n'));
  console.log('텔레그램 발송 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
