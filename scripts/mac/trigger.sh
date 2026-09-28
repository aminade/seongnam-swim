#!/bin/bash
# 맥에서 정해진 시각에 GitHub Actions 워크플로를 "즉시 실행"으로 트리거한다.
#
# GitHub 예약(cron) 실행은 공용 큐를 타서 4시간 넘게 밀린 적이 있다(2026-09: 21:17 예정 → 새벽 2시 실행).
# 어차피 실행 자체는 이 맥(self-hosted 러너)에서 돌기 때문에, 시각은 맥의 launchd가 잡는 편이 정확하다.
# 수동 실행(workflow_dispatch)은 큐 대기 없이 바로 시작된다.
#
# 사용: trigger.sh <워크플로 파일명>
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOG="$HOME/.swim-notice/trigger.log"
mkdir -p "$(dirname "$LOG")"
echo "[$(date '+%F %T')] trigger $1" >> "$LOG"
gh workflow run "$1" --repo aminade/seongnam-swim >> "$LOG" 2>&1 || echo "[$(date '+%F %T')] 실패: $1" >> "$LOG"
