#!/usr/bin/env bash
# Runs every host-testable suite in the repo. Exits non-zero if any suite fails.
# Requires: Node 22+, a C compiler (gcc/clang), and a JDK (javac/java) on PATH.
set -u
root="$(cd "$(dirname "$0")" && pwd)"
fail=0

echo "=== Hub (node:test) ==="
( cd "$root/hub" && npm run typecheck && npm test ) || fail=1

echo "=== agent-core (gcc) ==="
(
  cd "$root/agent-core" && mkdir -p build &&
  gcc -std=c99 -Wall -Wextra -O2 -Iinclude -Itest src/*.c test/*.c -o build/cgtest &&
  ./build/cgtest
) || fail=1

echo "=== android/shared (javac/java) ==="
(
  cd "$root/android/shared" && mkdir -p build &&
  javac -Xlint:all -d build $(find src -name '*.java') &&
  java -cp build com.consolegate.shared.TestMain
) || fail=1

echo
if [ "$fail" -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "SOME SUITES FAILED"; fi
exit "$fail"
