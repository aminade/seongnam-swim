#!/usr/bin/env node
/**
 * 금곡 강습 신청 알림 — 매일 점검 메시지와 별개로 발송한다.
 *
 * 보내는 시점(KST)
 *   ① 새 강습 공지를 인지한 다음 아침 8시   (LESSON_MODE 미지정, 아침 실행)
 *   ② 신규 접수 전날 밤 (밤 점검에 얹어서)    (LESSON_MODE=eve)
 *   ③ 신규 접수 당일 아침 8시
 *   ④ 1차 추첨 신청 시작일 저녁 7시
 * 같은 달·같은 종류는 한 번만 보낸다(~/.swim-notice/lesson-state.json).
 *
 * 관심 종목·시간은 data/lesson-watch.json 에서 읽는다. 표를 규칙으로 읽어내므로(AI 미사용)
 * 메시지에는 항상 원본 공지 링크를 함께 넣어 사람이 확인할 수 있게 한다.
 *
 * 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (DRY_RUN=1이면 콘솔 출력만)
 *           LESSON_MODE=eve|morning|evening (미지정 시 현재 시각으로 판단), LESSON_FORCE=new|signup|lottery (테스트)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spoPosts, spoBoardOf } from './notice-sources.js';
import { extractPostText } from './notice-extract.js';
import { parseSwimCourses, parseBadminton, parseSchedule, matchWatch, targetMonthOf, isLottery } from './lesson-parse.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dir, '..', 'data', 'lesson-watch.json'), 'utf-8'));
const STATE_PATH = process.env.LESSON_STATE || join(homedir(), '.swim-notice', 'lesson-state.json');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const kstToday = () => kstNow().toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = ymd => { const d = new Date(`${ymd}T00:00:00Z`); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`; };
const fmtAt = t => t ? `${fmtDay(t.date)}${t.hour != null ? ` ${t.hour}시` : ''}` : '확인 필요';

const loadState = () => (existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf-8')) : { sent: {} });
const saveState = st => { mkdirSync(dirname(STATE_PATH), { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify(st, null, 1)); };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b = s => `<b>${esc(s)}</b>`;
const i = s => `<i>${esc(s)}</i>`;

async function send(text) {
  if (process.env.DRY_RUN === '1') { console.log('\n──────── DRY_RUN ────────\n' + text + '\n─────────────────────────'); return; }
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Telegram 발송 실패: ${JSON.stringify(j)}`);
}

function buildMessage(kind, { month, matches, schedule, programUrl, hasSignupNotice, registered }) {
  const L = [];
  const kinds = matches.map(m => m.종목).join(', ');
  const headSuffix = { 'signup-eve': ' — 내일 신규 접수', signup: ' — 오늘 신규 접수', lottery: ' — 오늘 추첨 신청 시작' }[kind] || '';
  if (!matches.length) {
    L.push(`⭐ ${b(`금곡 ${month}월 강습`)} — 관심 강좌 미개설`);
    L.push('');
    const watchList = Object.entries(CONFIG.관심).map(([k, v]) => (v.강좌.length ? `${k} ${v.강좌.join('·')}` : k)).join(', ');
    L.push(`관심 목록(${esc(watchList)})에 해당하는 강좌가 이번 달 시간표에 없어요.`);
    L.push(`<a href="${esc(programUrl)}">${month}월 강습프로그램 보기</a>`);
    return L.join('\n');
  }
  L.push(`⭐ ${b(`금곡 ${month}월 강습 신청 - ${kinds}`)}${headSuffix}`);
  L.push('');
  for (const m of matches) {
    const items = m.항목.map(x => (x.name === '배드민턴' ? x.time : `${x.name} (${x.time})`)).join(', ');
    L.push(`${m.아이콘} ${b(m.종목)} ${esc(items)}`);
  }
  L.push('');
  if (!hasSignupNotice) {
    L.push(i('수강신청 안내 공지가 아직 안 올라왔어요. 올라오면 일정을 다시 알려드릴게요.'));
  } else {
    // 해당되는 일정만 넣는다: 추첨 종목이 있으면 추첨, 선착순 종목이 있으면 신규 접수,
    // 이미 등록한 종목이 있을 때만 재등록.
    const anyLottery = matches.some(m => m.항목.some(x => isLottery(m.종목, x.name)));
    const anyFirstCome = matches.some(m => m.항목.some(x => !isLottery(m.종목, x.name)));
    const lt = schedule.lottery;
    if (anyLottery && lt) L.push(`추첨 : 신청 ${fmtDay(lt.from.date)} ${lt.from.hour}시~${fmtDay(lt.to.date)} 24시, 추첨 ${fmtDay(lt.draw.date)} ${lt.draw.hour}시`);
    if (anyFirstCome) L.push(`신규 접수 : ${fmtAt(schedule.signup)}`);
    if (registered?.length && schedule.reRegister) L.push(`재등록 : ${fmtDay(schedule.reRegister.from.date)}~${fmtDay(schedule.reRegister.to.date)}`);
  }
  L.push('');
  L.push(`<a href="${esc(programUrl)}">${month}월 강습프로그램 →</a>`);
  return L.join('\n');
}

async function main() {
  const now = kstNow();
  const today = kstToday();
  const hour = now.getUTCHours(); // kstNow는 KST 벽시계를 UTC 필드로 담고 있다
  const mode = process.env.LESSON_MODE || (hour < 12 ? 'morning' : 'evening');
  console.log(`=== 금곡 강습 알림 점검 (${today} ${hour}시 · mode=${mode}) ===`);

  const posts = await spoPosts(spoBoardOf(CONFIG.pool.id));
  const program = posts.find(p => /강습\s*프로그램/.test(p.title) && !/수강신청|추첨제/.test(p.title));
  if (!program) { console.log('강습프로그램 공지 없음 — 종료'); return; }
  const tm = targetMonthOf(program.title, now);
  if (!tm) { console.log(`대상 월을 못 읽음: ${program.title}`); return; }
  const monthKey = `${tm.year}-${String(tm.month).padStart(2, '0')}`;
  console.log(`대상: ${monthKey} · 「${program.title}」`);

  const signupPost = posts.find(p => /수강신청|추첨제/.test(p.title) && new RegExp(`${tm.month}\\s*월`).test(p.title));
  const pText = (await extractPostText(program)).text;
  const swim = parseSwimCourses(pText);
  const badminton = parseBadminton(pText);
  const matches = matchWatch(CONFIG, swim, badminton);
  const schedule = signupPost ? parseSchedule((await extractPostText(signupPost)).text, tm.year, tm.month) : { reRegister: null, signup: null, lottery: null };
  console.log(`개설: 수영 ${swim.length}개 · 배드민턴 ${badminton.length}개 → 관심 일치 ${matches.length}종목`);
  console.log(`일정: 신규 ${schedule.signup?.date || '-'} · 추첨신청 ${schedule.lottery?.from.date || '-'}`);

  const state = loadState();
  const already = k => !!state.sent?.[`${monthKey}:${k}`];
  const mark = k => { (state.sent ??= {})[`${monthKey}:${k}`] = new Date().toISOString(); saveState(state); };

  const forced = process.env.LESSON_FORCE;
  const due = [];
  if (forced) due.push(forced);
  else {
    // ① 새 공지 인지 후 첫 아침. 신규 접수·추첨 신청이 이미 다 끝난 달이면 보내지 않고 기록만 한다.
    const ends = [schedule.signup?.date, schedule.lottery?.to.date].filter(Boolean);
    const allPast = ends.length > 0 && ends.every(d => d < today);
    if (mode === 'morning' && !already('new')) {
      if (allPast) { mark('new'); console.log('접수·추첨 일정이 이미 지남 — 새 공지 알림 생략'); }
      else due.push('new');
    }
    // 관심 강좌가 없으면 이후 접수·추첨 알림은 보내지 않는다
    if (matches.length) {
      if (mode === 'eve' && schedule.signup && addDays(today, 1) === schedule.signup.date && !already('signup-eve')) due.push('signup-eve');
      if (mode === 'morning' && schedule.signup && today === schedule.signup.date && !already('signup')) due.push('signup');
      if (mode === 'evening' && schedule.lottery && today === schedule.lottery.from.date && !already('lottery')) due.push('lottery');
    }
  }
  if (!due.length) { console.log('보낼 알림 없음'); return; }

  for (const kind of due) {
    const text = buildMessage(kind, { month: tm.month, matches, schedule, programUrl: program.url, hasSignupNotice: !!signupPost, registered: CONFIG.이미등록 });
    await send(text);
    if (!forced) mark(kind);
    console.log(`발송: ${kind}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
