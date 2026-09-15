#!/usr/bin/env bash
# Runs ./gradlew in android/ while holding a machine-wide lock, so concurrent sessions never run
# two Gradle builds against the same project at once.
#
#   bash scripts/dev/gradle.sh :vidorax-media:compileDebugKotlin
#   bash scripts/dev/gradle.sh assembleDebug
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCK="${TMPDIR:-/tmp}/vidorax-gradle.lock"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
  export JAVA_HOME
fi

waited=0
until mkdir "$LOCK" 2>/dev/null; do
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$LOCK"
    continue
  fi
  if [ "$waited" -ge 2400 ]; then
    echo "gradle.sh: another Gradle build has held the lock for over 40 minutes (pid ${holder:-unknown})" >&2
    exit 75
  fi
  if [ $((waited % 60)) -eq 0 ]; then
    echo "gradle.sh: waiting for Gradle lock held by pid ${holder:-unknown}..." >&2
  fi
  perl -e 'select(undef, undef, undef, 5)'
  waited=$((waited + 5))
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

cd "$ROOT/android"
./gradlew --console=plain "$@"
