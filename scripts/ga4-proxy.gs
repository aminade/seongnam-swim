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

  // ── 오늘 핵심 지표 ──
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
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
      { name: 'newUsers' },
    ],
  });
  const yesterdayR = gaRunReport(prop, {
    dateRanges: [{ startDate: yesterday, endDate: yesterday }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 이번달 ──
  const monthR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 전체 누적 ──
  const totalR = gaRunReport(prop, {
    dateRanges: [{ startDate: '2024-01-01', endDate: todayStr }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 30일 추이 ──
  const trendR = gaRunReport(prop, {
    dateRanges: [{ startDate: '29daysAgo', endDate: todayStr }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  // ── 시간대별 (오늘) ──
  const hourlyR = gaRunReport(prop, {
    dateRanges: [{ startDate: todayStr, endDate: todayStr }],
    dimensions: [{ name: 'hour' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ dimension: { dimensionName: 'hour' } }],
  });

  // ── 기기 유형 (이번달) ──
  const deviceR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 유입 경로 (이번달) ──
  const sourceR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 8,
  });

  // ── 지역 (이번달) ──
  const cityR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'city' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 5,
  });

  // ── 탭 클릭 (이번달) ──
  const tabR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'tab_' } },
    },
  });

  // ── 수영장 클릭 (이번달) ──
  const poolR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'pool_' } },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  // ── 한강 페이지 방문 (세션 기준, 이번달) ──
  // 가상 페이지뷰(page_title로 식별)의 세션 수를 쓴다. 진입 버튼(둥둥이)이 바뀌거나
  // 없어져도 이 가상 페이지뷰만 유지하면 계속 같은 방식으로 집계되고, 같은 세션에서
  // 여러 번 들어와도 sessions 지표는 세션 단위로 묶여서 중복 집계되지 않는다.
  // pagePath가 아니라 pageTitle로 거르는 이유: pagePath는 GitHub Pages 서브경로에 좌우된다.
  const hangangViewR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: {
      filter: { fieldName: 'pageTitle', stringFilter: { matchType: 'EXACT', value: HANGANG_PAGE_TITLE } },
    },
  });

  // ── 한강 페이지 이탈(성남으로 돌아가기) (이번달) ──
  const hangangBackR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'hangang_back' } },
    },
  });

  // ── 한강 시설별 펼치기 (이번달) ──
  const hangangPoolR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'hangang_pool_' } },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  // ── 한강 네이버 예약 클릭 (이번달) ──
  const hangangBookR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'hangang_book_' } },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  // ── 한강 페이지 방문 30일 추이 (세션 기준) ──
  const hangangTrendR = gaRunReport(prop, {
    dateRanges: [{ startDate: '29daysAgo', endDate: todayStr }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: {
      filter: { fieldName: 'pageTitle', stringFilter: { matchType: 'EXACT', value: HANGANG_PAGE_TITLE } },
    },
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  // ── 신규 vs 재방문 (이번달) ──
  const nvrR = gaRunReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: todayStr }],
    dimensions: [{ name: 'newVsReturning' }],
    metrics: [{ name: 'activeUsers' }],
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

  // 오늘 / 어제 (각각 별도 요청이라 항상 rows[0]이 그 날짜의 값)
  const todayVisitors  = metricVal(todayR, 0, 0);
  const ystdVisitors   = metricVal(yesterdayR, 0, 0);
  const todaySessions  = metricVal(todayR, 0, 1);
  const todayPageviews = metricVal(todayR, 0, 2);
  const avgDuration    = metricVal(todayR, 0, 3);
  const bounceRate     = metricVal(todayR, 0, 4);

  const monthVisitors  = metricVal(monthR, 0, 0);
  const totalVisitors  = metricVal(totalR, 0, 0);

  // 30일 추이
  const trend = (trendR.rows || []).map(r => ({
    date:     r.dimensionValues[0].value,
    users:    parseInt(r.metricValues[0].value) || 0,
    newUsers: parseInt(r.metricValues[1].value) || 0,
  }));

  // 시간대
  const hourly = Array(24).fill(0);
  (hourlyR.rows || []).forEach(r => {
    hourly[parseInt(r.dimensionValues[0].value)] = parseInt(r.metricValues[0].value) || 0;
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

  // 수영장 클릭
  const pools = (poolR.rows || []).map(r => ({
    id:     r.dimensionValues[0].value.replace('pool_', ''),
    name:   POOL_NAMES[r.dimensionValues[0].value.replace('pool_', '')] || r.dimensionValues[0].value,
    clicks: parseInt(r.metricValues[0].value) || 0,
  }));

  // 한강 페이지 방문(세션)/이탈
  const hangangOpens = metricVal(hangangViewR, 0, 0);
  const hangangBacks = metricVal(hangangBackR, 0, 0);

  // 한강 시설별 펼치기
  const hangangPools = (hangangPoolR.rows || []).map(r => {
    const id = r.dimensionValues[0].value.replace('hangang_pool_', '');
    return { id, name: HANGANG_POOL_NAMES[id] || id, clicks: parseInt(r.metricValues[0].value) || 0 };
  });

  // 한강 네이버 예약 클릭
  const hangangBooks = (hangangBookR.rows || []).map(r => {
    const id = r.dimensionValues[0].value.replace('hangang_book_', '');
    return { id, name: HANGANG_POOL_NAMES[id] || id, clicks: parseInt(r.metricValues[0].value) || 0 };
  });
  const hangangBookTotal = hangangBooks.reduce((s, b) => s + b.clicks, 0);
  const hangangConversionRate = hangangOpens > 0 ? Math.round(hangangBookTotal / hangangOpens * 100) : 0;

  // 한강 진입 30일 추이
  const hangangTrend = (hangangTrendR.rows || []).map(r => ({
    date: r.dimensionValues[0].value,
    opens: parseInt(r.metricValues[0].value) || 0,
  }));

  // 진짜 실시간 접속자
  const realtime = metricVal(realtimeR, 0, 0);

  // 재방문율
  const nvrObj = rowsToObj(nvrR, 0, 0);
  const nvrTotal = Object.values(nvrObj).reduce((a, b) => a + b, 0) || 1;
  const returningRate = Math.round((nvrObj['returning'] || 0) / nvrTotal * 100);

  // 어제 대비 증감
  const visitorsDiff = ystdVisitors > 0
    ? Math.round((todayVisitors - ystdVisitors) / ystdVisitors * 100)
    : 0;

  return {
    today:       { visitors: Math.round(todayVisitors), sessions: Math.round(todaySessions), pageviews: Math.round(todayPageviews) },
    yesterday:   { visitors: Math.round(ystdVisitors) },
    month:       { visitors: Math.round(monthVisitors) },
    total:       { visitors: Math.round(totalVisitors) },
    realtime:    Math.round(realtime),
    debug:       { todayStr, yesterday, propertyTimeZone },
    avgDuration,
    bounceRate:  Math.round(bounceRate * 100),
    returningRate,
    visitorsDiff,
    trend,
    hourly,
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
