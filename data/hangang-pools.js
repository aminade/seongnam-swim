// 한강 수영장·물놀이장 데이터 (서울시 미래한강본부 운영, 매년 수작업 갱신 필요)
// 출처: hangang.seoul.go.kr 공식 안내(사용자가 공식 페이지 캡처로 제공) + 언론/블로그 후기
//       (공식 사이트가 JS 렌더링이라 자동 스크래핑은 안 되고, 사용자가 직접 확인한 텍스트를 반영함)
// value가 null이면 "정보 못 찾음", note에 사유를 남김. 매 시즌(6~8월) 개장 전 재확인 필요.

// 공통 운영 규정 (2026 시즌, 6곳 전체 적용) — 사용자가 확인한 공식 페이지 기준, confidence: high
const HANGANG_COMMON = {
  season: { open: '2026-06-19', close: '2026-08-30', note: '개장 기간 중 휴무일 없음. 폭우로 인한 침수 위험 시 일시 중단' },
  closingBuffer: '운영 종료 30분 전 물놀이 마감',
  restBreaks: {
    hourly: '매시 15분간 휴식(입수 불가)',
    lunch: '12:00~13:00 (입수 불가)',
    evening: '17:30~19:00 (입수 불가)', // 2026-07-13 사용자 정정: 18:00~19:00 → 17:30~19:00
  },
  price: {
    pool: { adult: 5000, teen: 4000, child: 3000 },
    play: { adult: 3000, teen: 2000, child: 1000 },
    free: '만 6세 미만 무료(실물 증빙서류 지참)',
    discount: '다둥이행복카드+신분증, 65세 이상, 장애인복지카드 등 증빙서류 지참 시 할인',
  },
  ban: ['주류', '칼', '통째 과일', '가스버너', '유리병', '대형 튜브', '스노클링 장비', '오리발', '물총', '배달음식'],
  ticketing: {
    default: '네이버 예약',
    naverReservation: true,
    // naverBookingUrl(booking.naver.com/booking/5/bizes/1192307)은 여러 기사에서 "한강 수영장
    // 예약 링크"로 인용되지만, 접속 시 바로 네이버 로그인 화면부터 뜨는 게 확인되어(2026-07-13)
    // 실제 링크로는 채택 안 함 — 대신 아래처럼 네이버 지도 검색(장소명 단독 검색 시 결과가
    // 하나면 바로 업체 상세 페이지로 진입, 앱 설치 시 앱으로 전환, 로그인 없이 예약 버튼까지 도달)
    // 방식을 씀. UI 쪽 encodeURIComponent(pool.name)으로 링크 생성.
    naverBookingUrl: 'https://booking.naver.com/booking/5/bizes/1192307', // 참고용 보관, UI에서는 미사용
    // 2026-07-13 재검색: 초기엔 여의도·양화·난지만 네이버 예약 지원한다고 기록했으나,
    // 뚝섬(현장방문도 병행 가능)·잠실(사전예약 필수로 보도됨)·광나루도 네이버 예약 가능하다는
    // 블로그·기사 근거가 나와 6곳 전체 naverReservation:true로 수정. 매 시즌 개장 전 재확인 필요.
    naverReservationNote: '6곳 모두 네이버 예약(하나의 통합 예약 페이지에서 시설 선택) 온라인 구매 가능.',
  },
  confidence: 'high',
  source: { label: '한강 공식 페이지(사용자 확인본)', url: 'https://hangang.seoul.go.kr/www/contents/774.do?mid=505' },
};

const HANGANG_POOLS = [
  {
    id: 'ddukseom',
    naverPlaceId: '21025337', // 사용자가 네이버 지도 앱에서 직접 확인해 제공 (2026-07-13)
    name: '뚝섬 한강공원 수영장',
    type: 'pool', // pool: 수영장(성인 이용 가능한 정식 수영장) / play: 물놀이장(유아·아동 위주 얕은 물놀이 시설)
    area: '광진구 자양동',
    url: 'https://hangang.seoul.go.kr/www/contents/774.do?mid=505',
    hours: { day: '09:00~18:00', night: '18:00~22:00', nightFrom: '2026-07-03', nightAvailable: true },
    naverReservation: true, // 2026-07-13 재검색: 현장방문도 가능하지만 네이버 예약도 지원 (출처: 서울시 미디어허브)
    locker: { price: 2000, note: null,
      source: { label: '내 손안에 서울 이용팁', url: 'https://opengov.seoul.go.kr/mediahub/28777726' } },
    parasol: { price: 0, note: '선착순 무료, 정오 이후 만석 잦음',
      source: { label: '서울시 미디어허브 후기', url: 'https://mediahub.seoul.go.kr/archives/2018546' } },
    sunbed: { price: 10000, note: '종일 이용',
      source: { label: '서울시 미디어허브 후기', url: 'https://mediahub.seoul.go.kr/archives/2018546' } },
    foodPolicy: { allowed: true, note: '다회용기 음식 반입 가능 / 배달음식·일회용용기·편의점음료·옥수수 등 반입 금지',
      source: { label: '서울시 미디어허브 후기', url: 'https://mediahub.seoul.go.kr/archives/2018546' } },
    alcoholPolicy: { allowed: false, note: '음주 후 입수 금지(공통규정)' },
    confidence: 'medium', // 개별 항목(락커/파라솔/선베드/음식)만의 신뢰도. 기간·시간·요금은 HANGANG_COMMON(high) 참조
  },
  {
    id: 'yeouido',
    naverPlaceId: '32762442',
    name: '여의도 한강공원 수영장',
    type: 'pool',
    area: '영등포구 여의도동',
    url: 'https://hangang.seoul.go.kr/www/facility/map.tab?srchCd=9016',
    hours: { day: '09:00~18:00', night: '18:00~22:00', nightFrom: '2026-07-03', nightAvailable: true },
    naverReservation: true,
    locker: { price: null, note: '검색으로 확인 못함 — 현장 문의 필요' },
    parasol: { price: 0, note: '선착순 무료, 정오 이후 만석 잦음',
      source: { label: '서울시 미디어허브 후기', url: 'https://mediahub.seoul.go.kr/archives/2018546' } },
    sunbed: { price: 10000, note: '보증금 5,000원 별도(성인 1인 1좌석) / 야간 패키지 30,000원(야간입장권2+선베드2+파라솔1+음료2)',
      source: { label: '서울시 미디어허브 "야간 필독 준비물"', url: 'https://mediahub.seoul.go.kr/archives/2011895' } },
    foodPolicy: { allowed: true, note: '다회용기 음식 반입 가능 / 배달음식·일회용용기·편의점음료·옥수수 등 반입 금지',
      source: { label: '서울시 미디어허브 후기', url: 'https://mediahub.seoul.go.kr/archives/2018546' } },
    alcoholPolicy: { allowed: false, note: '음주 후 입수 금지(공통규정)' },
    confidence: 'medium',
  },
  {
    id: 'jamsil',
    naverPlaceId: '11618158',
    name: '잠실 한강공원 물놀이장',
    type: 'play',
    area: '송파구 잠실동',
    url: 'https://hangang.seoul.go.kr/www/facility/map.tab?srchCd=9014',
    hours: { day: '09:00~18:00', night: '18:00~22:00', nightFrom: '2026-07-03', nightAvailable: true },
    naverReservation: true, // 2026-07-13 재검색: 사전예약 필수로 보도됨(utrip.kr) — 현장예매 불가할 수 있어 온라인 예약 권장
    locker: { price: null, note: '검색으로 확인 못함' },
    parasol: { price: 0, note: '선착순 무료',
      source: { label: '서울시 미디어허브 후기(뚝섬·여의도 글에서 일반화, 잠실 개별 확인 안 됨)', url: 'https://mediahub.seoul.go.kr/archives/2018546' } },
    sunbed: { price: null, note: '정보 없음(물놀이장은 선베드 미제공 가능성)' },
    foodPolicy: { allowed: true, note: '공통 규정(주류·배달음식 금지) 적용 추정, 개별 확인 안 됨' },
    alcoholPolicy: { allowed: false, note: '공통 규정 적용 추정' },
    confidence: 'low',
  },
  {
    id: 'gwangnaru',
    naverPlaceId: '11781740',
    name: '광나루 한강공원 물놀이장',
    type: 'play',
    area: '광진구 광장동',
    url: 'https://hangang.seoul.go.kr/www/facility/map.tab?srchCd=9013',
    hours: { day: '09:00~18:00', night: null, nightFrom: null, nightAvailable: false }, // 공식: 뚝섬·여의도·잠실·난지만 야간, 광나루·양화 제외
    naverReservation: true, // 2026-07-13 재검색: 네이버 지도 예약 가능하다는 후기 확인
    locker: { price: null, note: '검색으로 확인 못함' },
    parasol: { price: 0, note: '선착순 무료',
      source: { label: '에스콰이어 코리아 가이드', url: 'https://www.esquirekorea.co.kr/article/1883600' } },
    sunbed: { price: null, note: '정보 없음' },
    foodPolicy: { allowed: true, note: '다회용기 음식 반입 가능 / 배달음식·주류 금지(공통규정 기반 추정, 개별 확인 안 됨)' },
    alcoholPolicy: { allowed: false, note: '공통 규정 적용 추정' },
    confidence: 'low',
  },
  {
    id: 'yanghwa',
    naverPlaceId: '398423512',
    name: '양화 한강공원 물놀이장',
    type: 'play',
    area: '영등포구 양화동',
    url: 'https://hangang.seoul.go.kr/www/facility/map.tab?srchCd=9019',
    hours: { day: '09:00~18:00', night: null, nightFrom: null, nightAvailable: false },
    naverReservation: true,
    locker: { price: 2000, note: '500원 동전 4개 투입식(검색 요약 결과, 원문 개별 URL 특정 못함)' },
    parasol: { price: 0, note: '입장 시 4인 기준 1개 무료 제공(선착순)' },
    sunbed: { price: null, note: '정보 없음' },
    foodPolicy: { allowed: true, note: '다회용기 음식 반입 가능 / 배달음식·주류·칼·유리병·가스버너 등 반입 금지, 적발 시 퇴장' },
    alcoholPolicy: { allowed: false, note: '공통 규정 적용 추정' },
    confidence: 'low',
  },
  {
    id: 'nanji',
    naverPlaceId: '13529706',
    name: '난지 한강공원 물놀이장',
    type: 'play',
    area: '마포구 상암동',
    url: 'https://hangang.seoul.go.kr/www/facility/map.tab?srchCd=9055',
    hours: { day: '09:00~18:00', night: '18:00~22:00', nightFrom: '2026-07-03', nightAvailable: true },
    naverReservation: true,
    locker: { price: null, note: '탈의실 존재만 확인, 요금 미확인',
      source: { label: 'infomoa.kr 이용정보 블로그', url: 'https://infomoa.kr/798' } },
    parasol: { price: 0, note: '선착순 무료, 그늘막 텐트 반입 가능(뚝섬은 간이텐트만 허용)',
      source: { label: '서울시 미디어허브 "이용팁"', url: 'https://mediahub.seoul.go.kr/archives/2011517' } },
    sunbed: { price: null, note: '정보 없음' },
    foodPolicy: { allowed: true, note: '집에서 준비한 간단 음식 O / 주류·배달음식 X',
      source: { label: 'infomoa.kr 이용정보 블로그', url: 'https://infomoa.kr/798' } },
    alcoholPolicy: { allowed: false, note: '금지',
      source: { label: 'infomoa.kr 이용정보 블로그', url: 'https://infomoa.kr/798' } },
    confidence: 'medium',
  },
];

// 참고: 잠원 한강공원 수영장은 2026년 리모델링 공사로 미운영(2028년 이후 재개장 예정)이라 목록에서 제외.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HANGANG_POOLS, HANGANG_COMMON };
}
