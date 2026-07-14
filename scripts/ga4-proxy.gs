// ═══════════════════════════════════════════════════════════════
// Swim Seongnam — GA4 대시보드 프록시
// Google Apps Script에 이 코드를 붙여넣고 웹 앱으로 배포하세요.
//
// 배포 방법:
//  1. script.google.com → 새 프로젝트
//  2. 이 코드 전체 붙여넣기
//  3. PROPERTY_ID를 본인 GA4 속성 ID로 교체 (숫자만, 예: 123456789)
//  4. 상단 메뉴 → 배포 → 새 배포
//     - 유형: 웹 앱
//     - 다음 사용자로 실행: 나(본인 계정)
//     - 액세스 권한: 모든 사용자
//  5. 배포 후 나오는 URL을 admin.html의 APPS_SCRIPT_URL에 붙여넣기
//
// 필요한 서비스:
//  왼쪽 + 서비스 → Google Analytics Data API 추가
// ═══════════════════════════════════════════════════════════════

const PROPERTY_ID = '543917208';

// ── 집계 리셋 기준 시각 ──
// 개발자 테스트 클릭과 실제 방문이 뒤섞여 구분 안 되는 지표들을 이 시각부터 다시 센다.
// GA4 dateHour 차원 포맷(YYYYMMDDHH, 시간대는 Asia/Seoul)과 정확히 맞춰서 "날짜"가 아니라
// "시각" 단위로 자른다 — 리셋 당일 하루를 통째로 버리지 않아도 된다.
// 리셋이 또 필요하면 이 값만 바꾸면 된다. 매일 자동으로 갱신되는 값이 아니라 고정 시각이다.
//
// 리셋 대상(이 시각부터 다시 셈): 탭 사용 현황, 수영장별 상세정보 보기(펼치기),
//   한강 페이지 방문/이탈/시설별 관심도/예약 클릭. — 전부 "개발자가 눌러본 클릭"과
//   섞이는 인터랙션 이벤트라서 리셋 대상.
// 리셋 대상 아님(그대로 전체 기간 반영): 방문자수(오늘/어제/이번달/누적/추이/요일별),
//   방문 지역, 기기 유형, 유입 경로, 재방문 패턴. — 이미 실방문자 기준으로 정상 집계되고
//   있다고 판단해서 리셋 안 함. 새 지표를 추가할 때도 이 두 분류 중 어디에 속하는지
//   먼저 정하고 맞는 쪽 헬퍼(gaRunReport vs gaRunReportSinceHour)를 쓸 것.
const COUNT_START_HOUR = '2026071416'; // 2026-07-14 16:00 KST

const POOL_NAMES = {
  tanchen:   '탄천종합운동장',
  seongnam:  '성남종합운동장',
  hwangse:   '황새울국민체육센터',
  geumgok:   '금곡스포츠센터',
  pangyo:    '판교스포츠센터',
  pyengsaeng:'평생학습스포츠센터',
  yc_yatap:  '야탑유스센터',
  yc_jungwon:'중원유스센터',
  yc_pangyo: '판교유스센터',
  yc_sujeong:'수정유스센터',
  bdolympic: '분당올림픽스포츠센터',
};

// index.html의 showHangang()이 보내는 가상 페이지뷰 page_title과 정확히 일치해야 한다.
const HANGANG_PAGE_TITLE = '한강 야외수영장 - Swim, Seongnam';

const HANGANG_POOL_NAMES = {
  ddukseom:  '뚝섬 한강공원 수영장',
  yeouido:   '여의도 한강공원 수영장',
  jamsil:    '잠실 한강공원 물놀이장',
  gwangnaru: '광나루 한강공원 물놀이장',
  yanghwa:   '양화 한강공원 물놀이장',
  nanji:     '난지 한강공원 물놀이장',
};

function doGet(e) {
  try {
    // ── 접근 토큰 검증 ──
    // 실제 토큰 값은 코드가 아니라 Apps Script의 스크립트 속성에 저장한다.
    // (프로젝트 설정 → 스크립트 속성 → ACCESS_TOKEN 추가)
    // 그래야 이 .gs 파일이 공개 저장소에 있어도 토큰이 노출되지 않는다.
    const expected = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
    const given = e && e.parameter && e.parameter.token;
    if (!expected || given !== expected) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = buildDashboardData();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, data }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// analytics.readonly 스코프 확보용 더미 — 절대 실행되지 않는다(지우지 말 것).
// Apps Script는 코드에 AnalyticsData 참조가 있어야 GA4 읽기 스코프를 토큰에 넣어준다.
// 실제 호출은 아래 gaRunReport(UrlFetch)로 하지만, 이 참조가 스코프를 확보해 준다.
function _keepAnalyticsScope() {
  if (false) AnalyticsData.Properties.runReport('properties/0', {});
}

// ── GA4 Data API 직접 호출 ──
// Apps Script의 AnalyticsData 고급 서비스가 로봇 404를 반환하는 문제가 있어,
// UrlFetchApp로 REST 엔드포인트를 직접 호출한다. (응답 구조는 동일)
function gaRunReport(prop, request) {
  const url = 'https://analyticsdata.googleapis.com/v1beta/' + prop + ':runReport';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(request),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('GA4 API ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

// 리셋 대상 쿼리 공용 헬퍼: 원래 요청한 dimensions 뒤에 'dateHour'를 추가로 붙여 받은 뒤,
// COUNT_START_HOUR 이전 행은 버리고 원래 dimensions 기준으로 다시 합산한다.
// sessions/eventCount처럼 그대로 더해도 되는(가산 가능한) 지표에만 써야 한다 —
// 평균·비율 지표(averageSessionDuration, bounceRate, sessionsPerUser 등)에는 쓰면 안 된다.
function gaRunReportSinceHour(prop, request) {
  const origDims = request.dimensions || [];
  const reqWithHour = Object.assign({}, request, {
    dimensions: origDims.concat([{ name: 'dateHour' }]),
  });
  const report = gaRunReport(prop, reqWithHour);
  const hourIdx = origDims.length;

  const agg = {};
  const order = [];
  (report.rows || []).forEach(r => {
    if (r.dimensionValues[hourIdx].value < COUNT_START_HOUR) return;
    const keyDims = r.dimensionValues.slice(0, origDims.length);
    const key = keyDims.map(v => v.value).join('');
    if (!agg[key]) {
      agg[key] = { dimensionValues: keyDims, metricValues: r.metricValues.map(() => 0) };
      order.push(key);
    }
    r.metricValues.forEach((mv, i) => {
      agg[key].metricValues[i] += parseFloat(mv.value) || 0;
    });
  });

  return {
    rows: order.map(key => ({
      dimensionValues: agg[key].dimensionValues,
      metricValues: agg[key].metricValues.map(v => ({ value: String(v) })),
    })),
  };
}

// ── 진짜 실시간 접속자 (Realtime Data API, runReport와 별개 엔드포인트) ──
function gaRunRealtimeReport(prop, request) {
  const url = 'https://analyticsdata.googleapis.com/v1beta/' + prop + ':runRealtimeReport';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(request),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('GA4 Realtime API ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

// ── 속성의 리포팅 타임존 조회 (Admin API) — "오늘"이 실제로 어느 시간대 기준인지 진단용 ──
function gaGetPropertyTimeZone(prop) {
  try {
    const url = 'https://analyticsadmin.googleapis.com/v1beta/' + prop;
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return '조회 실패(' + res.getResponseCode() + ')';
    const info = JSON.parse(res.getContentText());
    return info.timeZone || '알 수 없음';
  } catch (e) {
    return '조회 실패: ' + e.message;
  }
}

function buildDashboardData() {
  const prop = `properties/${PROPERTY_ID}`;
  const now = new Date();
  // 'today' 같은 GA4 상대 날짜 키워드는 속성(GA4 프로퍼티)에 설정된 리포팅 타임존 기준으로
  // 해석된다. 그 타임존이 Asia/Seoul이 아니면 "오늘"이 한국 기준 오늘이 아닐 수 있어서,
  // 모든 날짜를 이렇게 명시적으로 Asia/Seoul 기준 문자열로 고정해 쓴다.
  const todayStr = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
  const firstOfMonth = Utilities.formatDate(
    new Date(now.getFullYear(), now.getMonth(), 1),
    'Asia/Seoul', 'yyyy-MM-dd'
  );
  const yesterday = Utilities.formatDate(
    new Date(now.getTime() - 86400000),
    'Asia/Seoul', 'yyyy-MM-dd'
  );
  const propertyTimeZone = gaGetPropertyTimeZone(prop);

  const twentyNineDaysAgo = Utilities.formatDate(new Date(now.getTime() - 29 * 86400000), 'Asia/Seoul', 'yyyy-MM-dd');

  // ── 오늘 핵심 지표 (리셋 대상 아님 — 방문자수와 같은 분류) ──
  // 오늘/어제를 한 요청에 dateRanges 2개로 넣으면 응답 rows 순서가 요청 순서와 항상
  // 같다고 보장이 안 돼서(실측 결과 뒤바뀌어 나옴) 두 값이 뒤바뀔 수 있었다.
  // 'dateRange'를 dimensions에 넣어 라벨로 구분하는 방법도 시도했지만 GA4가
  // "dateRange는 dimension이 아니라 orderBy/pivot에만 쓸 수 있다"고 거부한다.
  // 그래서 아예 오늘/어제를 각각 별도 요청으로 분리해 모호함 자체를 없앤다.
  const todayR = gaRunReport(prop, {
    dateRanges: [{ startDate: todayStr, endDate: todayStr }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'newUsers' },
    ],
  });
  // 어제는 리셋 대상 아님(비교용 완전한 하루 그대로).
  const yesterdayR = gaRunReport(prop, {
    dateRanges: [{ startDate: yesterday, endDate: yesterday }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 오늘 페이지뷰 (COUNT_START_HOUR부터, 리셋 대상) ──
  // 페이지뷰는 방문자수와 달리 "클릭/인터랙션에 가까운 카운트"로 보고 리셋 대상으로 분류.
  // "인당 페이지뷰" 보조 수치도 같은 기준(16시 이후)으로 계산해야 의미가 맞아서, 그 계산에만
  // 쓸 방문자수(activeUsers)도 같은 리셋 범위로 같이 받는다 — 메인 "오늘 방문자" KPI(todayR,
  // 리셋 없음)와는 별개다.
  const todayPageviewsR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: todayStr, endDate: todayStr }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
  });

  // ── 오늘 평균체류시간/이탈률 (COUNT_START_HOUR부터, 리셋 대상) ──
  // 단순 카운트(방문자수·세션수)와 달리 평균·비율 지표는 표본이 작을 때(오늘 세션 몇십 개)
  // 이상치 세션 하나에도 크게 흔들린다 — 그래서 리셋 대상으로 분류.
  // averageSessionDuration/bounceRate 자체는 gaRunReportSinceHour로 합산하면 안 되는 평균·비율
  // 지표라서, 더해도 되는 원재료로 재계산한다: userEngagementDuration(총 참여시간),
  // engagedSessions(참여 세션수 — "bounces"라는 지표는 GA4 Data API에 없어서 대신 씀,
  // 이탈 세션수 = sessions - engagedSessions), 이 계산 전용 sessions.
  const todayQualityR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: todayStr, endDate: todayStr }],
    metrics: [{ name: 'userEngagementDuration' }, { name: 'engagedSessions' }, { name: 'sessions' }],
  });

  // ── 이번달 ── (방문자수 집계는 리셋 대상 아님 — 클램프 안 함)
  const monthR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 전체 누적 ── (리셋 대상 아님)
  const totalR = gaRunReport(prop, {
    dateRanges: [{ startDate: '2024-01-01', endDate: todayStr }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 30일 추이 ── (리셋 대상 아님)
  const trendR = gaRunReport(prop, {
    dateRanges: [{ startDate: twentyNineDaysAgo, endDate: todayStr }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  // ── 요일별 (이번달, 리셋 대상 아님) ──
  const dowR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'dayOfWeek' }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 시간대별 (오늘) ──
  const hourlyR = gaRunReport(prop, {
    dateRanges: [{ startDate: todayStr, endDate: todayStr }],
    dimensions: [{ name: 'hour' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ dimension: { dimensionName: 'hour' } }],
  });

  // ── 기기 유형 (이번달, 리셋 대상 아님) ──
  const deviceR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 유입 경로 (이번달, 리셋 대상 아님) ──
  const sourceR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 8,
  });

  // ── 지역 (이번달, 리셋 대상 아님) ──
  const cityR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'city' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 5,
  });

  // ── 탭 클릭 (COUNT_START_HOUR부터, 리셋 대상) ──
  const tabR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'tab_' } },
    },
  });

  // ── 수영장 클릭 (COUNT_START_HOUR부터, 리셋 대상) ──
  // orderBys는 dateHour로 쪼개기 전 원본 쿼리 기준이라 재집계 후엔 의미가 없다 —
  // 정렬은 아래 파싱 단계에서 clicks 기준으로 다시 한다.
  const poolR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'pool_' } },
    },
  });

  // ── 한강 페이지 방문 (세션 기준, COUNT_START_HOUR부터) ──
  // 가상 페이지뷰(page_title로 식별)의 세션 수를 쓴다. 진입 버튼(둥둥이)이 바뀌거나
  // 없어져도 이 가상 페이지뷰만 유지하면 계속 같은 방식으로 집계되고, 같은 세션에서
  // 여러 번 들어와도 sessions 지표는 세션 단위로 묶여서 중복 집계되지 않는다.
  // pagePath가 아니라 pageTitle로 거르는 이유: pagePath는 GitHub Pages 서브경로에 좌우된다.
  const hangangViewR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: {
      filter: { fieldName: 'pageTitle', stringFilter: { matchType: 'EXACT', value: HANGANG_PAGE_TITLE } },
    },
  });

  // ── 한강 페이지 이탈(성남으로 돌아가기) (COUNT_START_HOUR부터) ──
  const hangangBackR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'hangang_back' } },
    },
  });

  // ── 한강 시설별 펼치기 (COUNT_START_HOUR부터) ──
  const hangangPoolR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'hangang_pool_' } },
    },
  });

  // ── 한강 네이버 예약 클릭 (COUNT_START_HOUR부터) ──
  const hangangBookR = gaRunReportSinceHour(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'hangang_book_' } },
    },
  });

  // ── 한강 페이지 방문 30일 추이 (세션 기준, COUNT_START_HOUR부터) ──
  // 'date' 대신 'dateHour'로 받아서 COUNT_START_HOUR 이전 시간을 걸러낸 뒤 날짜별로 다시 묶는다
  // (일별 추이라 리셋 경계가 걸리는 날은 하루 중 일부만 포함돼야 하니 gaRunReportSinceHour의
  // "원래 dimensions 그대로 재집계" 방식이 아니라 날짜 단위로 직접 묶어야 한다).
  const hangangTrendHourly = gaRunReport(prop, {
    dateRanges: [{ startDate: twentyNineDaysAgo, endDate: todayStr }],
    dimensions: [{ name: 'dateHour' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: {
      filter: { fieldName: 'pageTitle', stringFilter: { matchType: 'EXACT', value: HANGANG_PAGE_TITLE } },
    },
    orderBys: [{ dimension: { dimensionName: 'dateHour' } }],
  });

  // ── 신규 vs 재방문 (이번달) ──
  // sessionsPerUser(1인당 평균 세션 수)를 같이 받아 재방문자의 평균 방문 횟수로 쓴다.
  const nvrR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'newVsReturning' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessionsPerUser' }],
  });

  // ── 진짜 실시간 접속자 (지난 30분, Realtime Data API) ──
  const realtimeR = gaRunRealtimeReport(prop, {
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 파싱 헬퍼 ──
  function metricVal(report, rowIdx, metricIdx) {
    const row = report.rows && report.rows[rowIdx];
    if (!row) return 0;
    const v = row.metricValues[metricIdx];
    return v ? parseFloat(v.value) || 0 : 0;
  }
  function rowsToObj(report, keyIdx, valIdx) {
    const obj = {};
    (report.rows || []).forEach(r => {
      obj[r.dimensionValues[keyIdx].value] = parseFloat(r.metricValues[valIdx].value) || 0;
    });
    return obj;
  }

  // 오늘 / 어제 (각각 별도 요청이라 항상 rows[0]이 그 날짜의 값) — 단순 카운트라 리셋 대상 아님
  const todayVisitors  = metricVal(todayR, 0, 0);
  const ystdVisitors   = metricVal(yesterdayR, 0, 0);
  const todaySessions  = metricVal(todayR, 0, 1);

  // 오늘 페이지뷰 — 리셋 대상. "인당 페이지뷰" 계산용 방문자수도 같은 리셋 범위로 따로 받는다.
  const todayPageviews = metricVal(todayPageviewsR, 0, 0);
  const todayPageviewsVisitors = metricVal(todayPageviewsR, 0, 1);

  // 오늘 평균체류시간/이탈률 — 리셋 대상. 가산 가능한 원재료를 리셋 범위로 합산한 뒤 직접 나눠서 계산.
  const todayQualitySessions = metricVal(todayQualityR, 0, 2);
  const todayEngagedSessions = metricVal(todayQualityR, 0, 1);
  const avgDuration = todayQualitySessions > 0 ? metricVal(todayQualityR, 0, 0) / todayQualitySessions : 0;
  const bounceRate  = todayQualitySessions > 0 ? (todayQualitySessions - todayEngagedSessions) / todayQualitySessions : 0;

  const monthVisitors  = metricVal(monthR, 0, 0);
  const totalVisitors  = metricVal(totalR, 0, 0);

  // 30일 추이
  const trend = (trendR.rows || []).map(r => ({
    date:     r.dimensionValues[0].value,
    users:    parseInt(r.metricValues[0].value) || 0,
    newUsers: parseInt(r.metricValues[1].value) || 0,
  }));

  // 시간대별 방문자 — 리셋 대상 아님(방문자수와 같은 분류, 하루 전체 그대로).
  const hourly = Array(24).fill(0);
  (hourlyR.rows || []).forEach(r => {
    hourly[parseInt(r.dimensionValues[0].value)] = parseInt(r.metricValues[0].value) || 0;
  });

  // 요일 (GA4 dayOfWeek: '0'=일 ~ '6'=토)
  const dayOfWeek = Array(7).fill(0);
  (dowR.rows || []).forEach(r => {
    dayOfWeek[parseInt(r.dimensionValues[0].value)] = parseInt(r.metricValues[0].value) || 0;
  });

  // 기기
  const devObj = rowsToObj(deviceR, 0, 0);
  const devTotal = Object.values(devObj).reduce((a, b) => a + b, 0) || 1;
  const devices = {
    mobile:  Math.round((devObj['mobile']  || 0) / devTotal * 100),
    desktop: Math.round((devObj['desktop'] || 0) / devTotal * 100),
    tablet:  Math.round((devObj['tablet']  || 0) / devTotal * 100),
  };

  // 유입 경로
  const sources = (sourceR.rows || []).map(r => ({
    source: r.dimensionValues[0].value,
    users:  parseInt(r.metricValues[0].value) || 0,
  }));

  // 지역
  const cities = (cityR.rows || []).map(r => ({
    city:  r.dimensionValues[0].value,
    users: parseInt(r.metricValues[0].value) || 0,
  }));

  // 탭 클릭
  const tabObj = rowsToObj(tabR, 0, 0);
  const tabs = {
    today:    tabObj['tab_today']    || 0,
    tomorrow: tabObj['tab_tomorrow'] || 0,
    calendar: tabObj['tab_calendar'] || 0,
  };

  // 수영장 클릭 (dateHour로 재집계한 뒤라 순서가 안 섞여 있으니 클릭수 기준으로 다시 정렬)
  const pools = (poolR.rows || []).map(r => ({
    id:     r.dimensionValues[0].value.replace('pool_', ''),
    name:   POOL_NAMES[r.dimensionValues[0].value.replace('pool_', '')] || r.dimensionValues[0].value,
    clicks: parseInt(r.metricValues[0].value) || 0,
  })).sort((a, b) => b.clicks - a.clicks);

  // 한강 페이지 방문(세션)/이탈
  const hangangOpens = metricVal(hangangViewR, 0, 0);
  const hangangBacks = metricVal(hangangBackR, 0, 0);

  // 한강 시설별 펼치기
  const hangangPools = (hangangPoolR.rows || []).map(r => {
    const id = r.dimensionValues[0].value.replace('hangang_pool_', '');
    return { id, name: HANGANG_POOL_NAMES[id] || id, clicks: parseInt(r.metricValues[0].value) || 0 };
  }).sort((a, b) => b.clicks - a.clicks);

  // 한강 네이버 예약 클릭
  const hangangBooks = (hangangBookR.rows || []).map(r => {
    const id = r.dimensionValues[0].value.replace('hangang_book_', '');
    return { id, name: HANGANG_POOL_NAMES[id] || id, clicks: parseInt(r.metricValues[0].value) || 0 };
  }).sort((a, b) => b.clicks - a.clicks);
  const hangangBookTotal = hangangBooks.reduce((s, b) => s + b.clicks, 0);
  const hangangConversionRate = hangangOpens > 0 ? Math.round(hangangBookTotal / hangangOpens * 100) : 0;

  // 한강 진입 30일 추이 — dateHour 행을 COUNT_START_HOUR 이후만 남기고 날짜(앞 8자리)로 재집계
  const hangangTrendByDate = {};
  const hangangTrendDateOrder = [];
  (hangangTrendHourly.rows || []).forEach(r => {
    const dateHour = r.dimensionValues[0].value;
    if (dateHour < COUNT_START_HOUR) return;
    const date = dateHour.slice(0, 8);
    if (!(date in hangangTrendByDate)) { hangangTrendByDate[date] = 0; hangangTrendDateOrder.push(date); }
    hangangTrendByDate[date] += parseInt(r.metricValues[0].value) || 0;
  });
  const hangangTrend = hangangTrendDateOrder.map(date => ({ date, opens: hangangTrendByDate[date] }));

  // 진짜 실시간 접속자
  const realtime = metricVal(realtimeR, 0, 0);

  // 재방문율 — 원본 사용자 수(newCount/returningCount)도 그대로 노출해서 반올림된 %만
  // 봐서는 안 보이는 실제 변화를 화면에서 바로 확인할 수 있게 한다.
  const nvrObj = rowsToObj(nvrR, 0, 0);
  const nvrTotal = Object.values(nvrObj).reduce((a, b) => a + b, 0) || 1;
  const newCount = Math.round(nvrObj['new'] || 0);
  const returningCount = Math.round(nvrObj['returning'] || 0);
  const returningRate = Math.round((nvrObj['returning'] || 0) / nvrTotal * 100);
  const sessionsPerReturningObj = rowsToObj(nvrR, 0, 1);
  const avgVisitsPerUser = Math.round((sessionsPerReturningObj['returning'] || 0) * 10) / 10;

  // 어제 대비 증감
  const visitorsDiff = ystdVisitors > 0
    ? Math.round((todayVisitors - ystdVisitors) / ystdVisitors * 100)
    : 0;

  return {
    today:       { visitors: Math.round(todayVisitors), sessions: Math.round(todaySessions), pageviews: Math.round(todayPageviews), pageviewsVisitors: Math.round(todayPageviewsVisitors) },
    yesterday:   { visitors: Math.round(ystdVisitors) },
    month:       { visitors: Math.round(monthVisitors) },
    total:       { visitors: Math.round(totalVisitors) },
    realtime:    Math.round(realtime),
    debug:       { todayStr, yesterday, propertyTimeZone, countStartHour: COUNT_START_HOUR },
    avgDuration,
    bounceRate:  Math.round(bounceRate * 100),
    returningRate,
    newVsReturning: { new: newCount, returning: returningCount },
    avgVisitsPerUser,
    visitorsDiff,
    trend,
    hourly,
    dayOfWeek,
    devices,
    sources,
    cities,
    tabs,
    pools,
    hangang: {
      opens: hangangOpens,
      backs: hangangBacks,
      conversionRate: hangangConversionRate,
      bookTotal: hangangBookTotal,
      pools: hangangPools,
      books: hangangBooks,
      trend: hangangTrend,
    },
    generatedAt: new Date().toISOString(),
  };
}
