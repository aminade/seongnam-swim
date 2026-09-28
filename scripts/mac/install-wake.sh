#!/bin/bash
# 맥 자동 깨우기 설치/제거. 설명은 scripts/mac/README.md
#   설치: sudo bash scripts/mac/install-wake.sh
#   제거: sudo bash scripts/mac/install-wake.sh --uninstall
#
# 실행 스크립트는 저장소가 아니라 /usr/local/libexec 에 root 소유로 복사한다.
# (공개 저장소 안의 파일을 root가 직접 실행하면, 저장소 파일이 바뀌는 것만으로 관리자 권한 코드가 돌게 된다)
set -euo pipefail
LABEL="com.seongnam-swim.wake"
OWNER="seongnam-swim"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
BIN="/usr/local/libexec/seongnam-swim-wake.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "관리자 권한이 필요해요. 이렇게 실행하세요:  sudo bash $0 ${1:-}"; exit 1
fi

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$BIN"
  # 이 작업이 걸어 둔 깨우기 예약만 취소(다른 앱 예약은 건드리지 않음)
  pmset -g sched | sed -n "s/.*wake at \([0-9/]* [0-9:]*\) by '$OWNER'.*/\1/p" | while read -r shown; do
    at=$(date -j -f "%m/%d/%Y %H:%M:%S" "$shown" "+%m/%d/%y %H:%M:%S")
    pmset schedule cancel wake "$at" "$OWNER" && echo "취소: $shown"
  done
  echo "제거 완료. 이제 맥을 자동으로 깨우지 않아요."
  exit 0
fi

mkdir -p /usr/local/libexec
install -o root -g wheel -m 755 "$HERE/wake-schedule.sh" "$BIN"
install -o root -g wheel -m 644 "$HERE/$LABEL.plist" "$PLIST"
launchctl bootout "system/$LABEL" 2>/dev/null || true
launchctl bootstrap system "$PLIST"
sleep 2
echo "설치 완료. 지금 걸린 깨우기 예약:"
pmset -g sched | grep "'$OWNER'" || echo "  (아직 없음 — 잠시 뒤 'pmset -g sched'로 다시 확인)"
