/**
 * 원본 이미지 검증 단계 실전 테스트 (API 호출 1회, 약 1~2센트).
 * 성남 10월 일일자유이용 안내(헬스장 칸에 "일일자유이용 불가"가 있는 표)로
 *  - 헬스장 칸 내용을 수영장 휴장이라고 한 주장은 false,
 *  - 실제 정기휴장(10/11)은 true 로 판정해야 한다.
 * 실행: ANTHROPIC_API_KEY=… node scripts/test/verify-claims.live.js  (워크플로 수동 실행 test_script로도 가능)
 */
import { collectPosts } from '../notice-sources.js';
import { collectPostImages } from '../notice-extract.js';
import { verifyClaims } from '../notice-ai.js';

const { posts } = await collectPosts({ log: () => {} });
const post = posts.find(p => p.key === 'spo02:0002475');
if (!post) { console.log('성남 10월 안내 글을 못 찾음(게시판에서 밀려났을 수 있음)'); process.exit(1); }
const images = await collectPostImages(post);
const cases = [
  ['10/5(월) 휴장(월회원만 이용 가능, 일일자유이용 불가)', false],
  ['10/10(토) 휴장(월회원만 이용 가능, 일일자유이용 불가)', false],
  ['10/11(일) 휴장(정기휴장)', true],
];
const v = await verifyClaims({ poolName: '성남종합운동장', title: post.title, images, claims: cases.map(c => c[0]) });
if (!v.ok) { console.log(`검증 호출 실패: ${v.reason}`); process.exit(1); }
let fail = 0;
for (const [i, [claim, want]] of cases.entries()) {
  const got = v.verdicts.find(x => x.index === i);
  const ok = got && got.correct === want;
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} ${claim} → ${got ? got.correct : '판정 없음'} (기대 ${want}) — ${got?.why || ''}`);
}
console.log(`이미지 ${images.length}장 · 토큰 입력 ${v.usage?.input_tokens} 출력 ${v.usage?.output_tokens}`);
console.log(fail ? `${fail}건 실패` : '전부 통과');
process.exit(fail ? 1 : 0);
