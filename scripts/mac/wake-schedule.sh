#!/bin/bash
# 성남 수영장 점검용 "맥 자동 깨우기" 예약 — 관리자(root) 권한으로 launchd가 실행한다.
#
# 왜: 점검·강습 알림은 이 맥의 GitHub 러너에서 돈다(07:58→08:00 강습 아침, 18:58→19:00 강습 저녁,
#     20:58→21:00 밤 점검). 맥이 잠들어 있으면 예약 시각을 놓치므로, 2분 먼저 깨워 둔다.
#     깨어난 뒤에는 워크플로 첫 단계(caffeinate)가 작업이 끝날 때까지 잠들지 않게 붙잡는다.
#
# 무엇을: 오늘·내일의 위 세 시각에 `pmset schedule wake`를 건다(이미 있으면 건너뜀).
#        예약 이름(owner)이 'seongnam-swim'이라 `pmset -g sched`에서 바로 보인다.
#
# 설치/제거·설명: scripts/mac/README.md  (설치본 위치: /usr/local/libexec/seongnam-swim-wake.sh)
# 테스트: DRY=1 LOG=/tmp/x.log bash wake-schedule.sh  → 실제로 예약하지 않고 할 일만 출력
set -u
OWNER="seongnam-swim"
TIMES="07:58 18:58 20:58"
LOG="${LOG:-/var/log/seongnam-swim-wake.log}"

now=$(date +%s)
sched=$(pmset -g sched)
for d in 0 1; do
  for t in $TIMES; do
    shown="$(date -v+${d}d +%m/%d/%Y) $t:00"   # pmset -g sched 표기(연도 4자리)
    at="$(date -v+${d}d +%m/%d/%y) $t:00"       # pmset schedule 입력 형식(연도 2자리)
    ts=$(date -j -f "%m/%d/%y %H:%M:%S" "$at" +%s)
    [ "$ts" -le "$now" ] && continue
    grep -q "wake at $shown by '$OWNER'" <<<"$sched" && continue
    if ${DRY:+echo} pmset schedule wake "$at" "$OWNER"; then
      echo "[$(date '+%F %T')] 깨우기 예약: $shown" >> "$LOG"
    else
      echo "[$(date '+%F %T')] 예약 실패: $shown" >> "$LOG"
    fi
  done
done
