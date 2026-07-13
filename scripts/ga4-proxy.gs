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

function buildDashboardData() {
  const prop = `properties/${PROPERTY_ID}`;
  const now = new Date();
  const firstOfMonth = Utilities.formatDate(
    new Date(now.getFullYear(), now.getMonth(), 1),
    'Asia/Seoul', 'yyyy-MM-dd'
  );
  const yesterday = Utilities.formatDate(
    new Date(now.getTime() - 86400000),
    'Asia/Seoul', 'yyyy-MM-dd'
  );

  // ── 오늘 핵심 지표 ──
  const todayR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [
      { startDate: 'today', endDate: 'today' },
      { startDate: yesterday, endDate: yesterday },
    ],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
      { name: 'newUsers' },
    ],
  });

  // ── 이번달 ──
  const monthR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: 'today' }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 전체 누적 ──
  const totalR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: '2024-01-01', endDate: 'today' }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 30일 추이 ──
  const trendR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: '29daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  // ── 시간대별 (오늘) ──
  const hourlyR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: 'today', endDate: 'today' }],
    dimensions: [{ name: 'hour' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ dimension: { dimensionName: 'hour' } }],
  });

  // ── 기기 유형 (이번달) ──
  const deviceR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: 'today' }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'activeUsers' }],
  });

  // ── 유입 경로 (이번달) ──
  const sourceR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 8,
  });

  // ── 지역 (이번달) ──
  const cityR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: 'today' }],
    dimensions: [{ name: 'city' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 5,
  });

  // ── 탭 클릭 (이번달) ──
  const tabR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'tab_' } },
    },
  });

  // ── 수영장 클릭 (이번달) ──
  const poolR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'BEGINS_WITH', value: 'pool_' } },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  // ── 신규 vs 재방문 (이번달) ──
  const nvrR = AnalyticsData.Properties.runReport(prop, {
    dateRanges: [{ startDate: firstOfMonth, endDate: 'today' }],
    dimensions: [{ name: 'newVsReturning' }],
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

  // 오늘 / 어제 (dateRanges 2개라 rowIdx로 구분)
  const todayVisitors  = metricVal(todayR, 0, 0);
  const ystdVisitors   = metricVal(todayR, 1, 0);
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
    generatedAt: new Date().toISOString(),
  };
}
