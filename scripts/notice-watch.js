/**
 * 공지 감시 파이프라인 — "제목으로 고르지 않고, 모든 게시판의 새 글·수정된 글을 전부 읽는다."
 *
 *  1) 수집   notice-sources.js : 성남도개공 6곳 + 분당올림픽 + 유스센터 4곳 게시판
 *  2) 선별   처음 보는 글 / 내용이 바뀐 글만(상태 파일에 글별 해시 저장). 운영 관련 단어가 없으면 여기서 끝.
 *  3) 추출   notice-extract.js : 본문·PDF·HWP·이미지(OCR)를 로컬에서 텍스트로 (무료)
 *  4) 해석   notice-ai.js      : 텍스트만 Claude(Sonnet)에 보내 휴장일·특별 시간표 등을 구조화
 *  5) 비교   site-model.js     : 사이트(index.html)가 같은 날을 어떻게 계산하는지와 대조
 *
 * 상태 파일(기본 ~/.swim-notice/state.json, NOTICE_STATE로 변경): 맥 러너에 영구 보관.
 *   - 한 번 해석한 글은 다시 AI에 보내지 않는다(비용). 해석 결과(facts)는 저장해 두고
 *     매일 사이트와 다시 대조 → 사이트에 반영되면 알림이 자동으로 사라지고, 아니면 "미반영"으로 계속 알린다.
 *   - 상태 파일이 없는 첫 실행: 최근 LOOKBACK_DAYS 이내 글만 읽고, 그보다 오래된 글은 "본 것"으로만 기록.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { collectPosts, htmlToText } from './notice-sources.js';
import { extractPostText } from './notice-extract.js';
import { interpretNotice, NOTICE_MODEL } from './notice-ai.js';

export const STATE_PATH = process.env.NOTICE_STATE || join(homedir(), '.swim-notice', 'state.json');
const LOOKBACK_DAYS = +(process.env.NOTICE_LOOKBACK_DAYS || 45);
const HORIZON_DAYS = 120; // 이만큼 먼 미래까지만 대조

// 운영에 영향이 있을 법한 글만 AI로 보낸다(나머지는 행사·모집 등).
const OPS_RE = /휴\s*[장관]|휴\s*무|미\s*운\s*영|운영\s*(중단|중지|종료|변경|조정|안내)|임시|공사|추석|설\s*연휴|명절|자유\s*수영|자유\s*이용|특별\s*운영|단축/;

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const md = d => `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
function* eachDay(from, to) {
  const d = parseDay(from); const end = parseDay(to);
  if (isNaN(d) || isNaN(end) || end - d > 400 * 864e5) return;
  for (; d <= end; d.setDate(d.getDate() + 1)) yield new Date(d);
}
// 연속된 날짜를 "10/9(금)~10/11(일)"처럼 묶는다.
export function fmtDates(dates) {
  const ds = [...new Set(dates.map(ymd))].sort().map(parseDay);
  const out = [];
  for (let i = 0; i < ds.length; i++) {
    let j = i;
    while (j + 1 < ds.length && ds[j + 1] - ds[j] <= 864e5 + 3600e3) j++;
    out.push(i === j ? md(ds[i]) : `${md(ds[i])}~${md(ds[j])}`);
    i = j;
  }
  // 구간이 많으면(종료일 미정 특별 운영 등) 처음~끝만: "10/1(목) ~ 1/8(금) 중 70일"
  if (out.length > 4) return `${md(ds[0])} ~ ${md(ds[ds.length - 1])} 중 ${ds.length}일`;
  return out.join(', ');
}

const normTime = t => String(t).replace(/\s/g, '').replace(/[–-]/g, '~').replace(/(\d{1,2}):?(\d{2})~(\d{1,2}):?(\d{2})/, (_, a, b, c, d) => `${pad(a)}:${b}~${pad(c)}:${d}`);
const startsOf = times => times.map(t => normTime(t).split('~')[0]).sort();

function dayTypeOf(site, date) {
  if (site.isHoliday(date) || date.getDay() === 0) return '일요일·공휴일';
  return date.getDay() === 6 ? '토요일' : '평일';
}

// 해석 결과(facts) ↔ 사이트 대조. 오늘 이전 날짜는 보지 않는다. → [{kind, text}]
// knownClosed: 같은 수영장의 다른 공지들이 휴장이라고 한 날짜(ymd Set). 월간 시간표 공지엔 휴장일이 빠져 있고
// 별도 "휴장일 안내" 글에만 있는 경우가 많아(금곡), 공지끼리 합쳐서 판단한다.
export function compareFacts(site, poolId, facts, today = new Date(), knownClosed = new Set()) {
  const pool = site.poolById[poolId];
  if (!pool || !facts) return [];
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const horizon = new Date(t0); horizon.setDate(horizon.getDate() + HORIZON_DAYS);
  const inWindow = d => d >= t0 && d <= horizon;
  const items = [];

  // 1) 공지=휴장인데 사이트=운영
  const noticeClosed = new Set();
  for (const c of facts.closures || []) {
    const miss = [];
    for (const d of eachDay(c.from, c.to)) {
      noticeClosed.add(ymd(d));
      if (inWindow(d) && !site.isClosedDay(pool, d)) miss.push(d);
    }
    if (miss.length) items.push({ kind: 'closed', text: `${fmtDates(miss)} 휴장(${c.reason}) → 사이트는 운영 중으로 표시` });
  }

  // 2) 공지=운영(명시)인데 사이트=휴관
  const openMiss = (facts.openDays || []).map(o => parseDay(o.date)).filter(d => inWindow(d) && site.isClosedDay(pool, d));
  if (openMiss.length) items.push({ kind: 'open', text: `${fmtDates(openMiss)} 운영(공지 명시) → 사이트는 휴관으로 표시` });

  // 3) 월 휴장일 전체 목록인데, 사이트만 쉬는 날이 있음
  const mc = facts.monthlyClosureList;
  if (mc && mc.year && mc.month) {
    const extra = [];
    for (let d = new Date(mc.year, mc.month - 1, 1); d.getMonth() === mc.month - 1; d.setDate(d.getDate() + 1)) {
      const day = new Date(d);
      if (inWindow(day) && site.isClosedDay(pool, day) && !noticeClosed.has(ymd(day))) extra.push(day);
    }
    if (extra.length) items.push({ kind: 'site-only-closed', text: `${fmtDates(extra)} 사이트는 휴관 → ${mc.month}월 휴장 공지엔 없음` });
  }

  // 4) 기간 한정 특별 시간표
  for (const s of facts.specialSchedules || []) {
    const want = startsOf(s.times || []);
    if (!want.length) continue;
    const bad = [];
    const closedButSpecial = [];
    let siteHas = '';
    for (const d of eachDay(s.from, s.to)) {
      if (!inWindow(d)) continue;
      if (s.dayType !== '매일' && dayTypeOf(site, d) !== s.dayType) continue;
      if (site.isClosedDay(pool, d)) {
        // 공지(이 글이든 다른 글이든)도 그날 휴장이라면 모순이 아니다.
        if (!noticeClosed.has(ymd(d)) && !knownClosed.has(ymd(d))) closedButSpecial.push(d);
        continue;
      }
      const have = startsOf(site.slotsFor(pool, d).map(x => x.time));
      // 대체(평소 대신 이것만)면 정확히 같아야 하고, 추가 운영이면 공지 시간이 사이트에 다 있으면 된다.
      const ok = s.replacesRegular === false ? want.every(t => have.includes(t)) : have.join(',') === want.join(',');
      if (!ok) { bad.push(d); siteHas = have.join('·') || '없음'; }
    }
    const price = s.adultPrice ? `, 성인 ${Number(s.adultPrice).toLocaleString()}원` : '';
    const verb = s.replacesRegular === false ? '추가 운영' : '';
    if (bad.length) items.push({ kind: 'schedule', text: `${fmtDates(bad)} ${s.dayType === '매일' ? '' : `${s.dayType} `}자유수영 ${want.join('·')}${verb ? ` ${verb}` : ''}${price} → 사이트는 ${siteHas}` });
    if (closedButSpecial.length) items.push({ kind: 'schedule', text: `${fmtDates(closedButSpecial)} 자유수영 운영(${want.join('·')}) → 사이트는 휴관으로 표시` });
  }
  return items;
}

// 상태에 저장된 모든 해석 결과에서 수영장별 "공지상 휴장일" 합집합
function closedIndex(state) {
  const idx = {};
  for (const e of Object.values(state.posts)) {
    if (!e.facts || !e.poolId) continue;
    const set = (idx[e.poolId] ??= new Set());
    for (const c of e.facts.closures || []) for (const d of eachDay(c.from, c.to)) set.add(ymd(d));
  }
  return idx;
}

const postHash = p => createHash('sha1')
  .update([p.title, htmlToText(p.bodyHtml), p.attachments.map(a => a.name).join('|'), p.images.length].join('\n'))
  .digest('hex').slice(0, 16);

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf-8')); } catch { return null; }
}
function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
}

export async function watchNotices({ site, log = console.log, today = new Date() } = {}) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const prev = loadState();
  const firstRun = !prev;
  const state = prev || { version: 1, posts: {} };
  const todayStr = ymd(today);
  const cutoff = ymd(new Date(today.getTime() - LOOKBACK_DAYS * 864e5));

  log(`게시판 수집${firstRun ? ' (첫 실행: 최근 ' + LOOKBACK_DAYS + '일 글만 읽음)' : ''}`);
  const { posts, errors } = await collectPosts({ log });

  const fresh = [];       // 이번에 새로 해석해서 사이트와 다른 점이 나온 글
  const manual = [];      // 자동 판독 불가 → 직접 확인
  const needsImpl = [];   // 새 구현 필요(이번에 처음 나온 것만)
  const stats = { posts: posts.length, read: 0, ops: 0, ai: 0, inputTokens: 0, outputTokens: 0 };
  let aiBlocked = null; // 키·계정 문제로 AI를 못 쓰게 되면 사유(이후 글은 호출하지 않음)
  const readNow = [];   // 이번에 해석한 관련 글(사이트 대조는 모든 글을 읽은 뒤에 한꺼번에)
  // 테스트용: NOTICE_ONLY(정규식)에 제목·키가 맞는 글만 읽는다(예산 절약 재시험).
  const only = process.env.NOTICE_ONLY ? new RegExp(process.env.NOTICE_ONLY) : null;

  for (const p of posts) {
    if (p.error) continue;
    if (only && !only.test(`${p.key} ${p.poolName} ${p.title}`)) continue;
    const h = postHash(p);
    const old = state.posts[p.key];
    const edited = old && old.hash !== h;
    const retryNoKey = old && old.status === 'no-key' && hasKey;
    if (old && !edited && !retryNoKey && !only) continue;
    if (!old && p.date && p.date < cutoff) { // 오래된 글(목록 상단 고정글 등) — 읽지 않고 기록만
      state.posts[p.key] = { hash: h, title: p.title, date: p.date, status: 'old', seenAt: todayStr };
      continue;
    }
    const entry = { hash: h, title: p.title, date: p.date, poolId: p.poolId, poolName: p.poolName, url: p.url, seenAt: todayStr, edited: !!edited };
    state.posts[p.key] = entry;
    stats.read++;
    log(`  · ${p.poolName} 「${p.title}」${edited ? ' (수정됨)' : ''}`);

    const ex = await extractPostText(p);
    if (!OPS_RE.test(`${p.title}\n${ex.text}`)) { entry.status = 'not-ops'; continue; }
    stats.ops++;
    if (ex.skipped.length) log(`      건너뜀: ${ex.skipped.map(s => `${s.name}(${s.reason})`).join(', ')}`);

    if (!hasKey || aiBlocked) {
      entry.status = 'no-key'; // 키가 생기거나 문제가 풀리면 다음 실행에서 다시 읽는다
      manual.push({ ...entry, reason: 'AI 키 미설정 — 휴장/운영 관련 단어가 있는 글' });
      continue;
    }
    const r = await interpretNotice({ poolName: p.poolName, title: p.title, date: p.date, text: ex.text });
    if (!r.ok && r.keyProblem) {
      aiBlocked = r.reason;
      log(`      ⛔ AI 사용 불가 — 이번 실행은 AI 호출 중단: ${r.reason}`);
      entry.status = 'no-key';
      manual.push({ ...entry, reason: 'AI 키 미설정 — 휴장/운영 관련 단어가 있는 글' });
      continue;
    }
    if (!r.ok) {
      entry.status = 'ai-fail';
      manual.push({ ...entry, reason: `자동 해석 실패(${r.reason})` });
      continue;
    }
    stats.ai++;
    stats.inputTokens += r.usage?.input_tokens || 0;
    stats.outputTokens += r.usage?.output_tokens || 0;
    entry.status = r.facts.relevant ? 'relevant' : 'irrelevant';
    entry.facts = r.facts;
    entry.skipped = ex.skipped;
    log(`      → ${r.facts.relevant ? r.facts.summary : '자유수영 무관'}`);
    if (!r.facts.relevant) continue;

    readNow.push(entry);
    for (const u of r.facts.unsupported || []) needsImpl.push({ ...entry, description: u.description });
    // 해석은 됐지만 일부 첨부를 못 읽었다면 알려서 사람이 확인할 수 있게
    const unread = ex.skipped.filter(s => !/같은 내용 PDF/.test(s.reason));
    if (unread.length) manual.push({ ...entry, reason: `일부 첨부 못 읽음: ${unread.map(s => s.name).join(', ')}` });
  }

  // 사이트 대조: 같은 수영장의 모든 공지 휴장일을 합쳐 놓고 비교(월간 시간표 글과 휴장일 글이 따로 올라옴)
  const closedByPool = closedIndex(state);
  for (const e of readNow) {
    const items = compareFacts(site, e.poolId, e.facts, today, closedByPool[e.poolId]);
    if (items.length) fresh.push({ ...e, summary: e.facts.summary, items });
  }

  // 이전에 알렸지만 아직 사이트에 반영 안 된 것(매일 재대조, 날짜가 지나면 자연 소멸)
  const freshKeys = new Set(fresh.map(f => f.url));
  const pending = [];
  for (const e of Object.values(state.posts)) {
    if (e.status !== 'relevant' || !e.facts || freshKeys.has(e.url)) continue;
    const items = compareFacts(site, e.poolId, e.facts, today, closedByPool[e.poolId]);
    if (items.length) pending.push({ ...e, items });
  }

  // 오래된 기록 정리(글이 1년 넘게 지난 항목)
  const yearAgo = ymd(new Date(today.getTime() - 365 * 864e5));
  for (const [k, e] of Object.entries(state.posts)) if (e.date && e.date < yearAgo) delete state.posts[k];
  state.lastRun = new Date().toISOString();
  if (process.env.NOTICE_DRY_STATE !== '1') saveState(state);

  return { firstRun, hasKey, aiBlocked, model: NOTICE_MODEL, fresh, pending, needsImpl, manual, errors, stats };
}
