#!/usr/bin/env bash
# Resume-download an npm tarball and seed it into the content-addressed cache.
#
# ⛔ This machine cannot download a large tarball in one shot: anything over
# ~20 MB dies partway with ERR_SSL_WRONG_VERSION_NUMBER, and npm RESTARTS rather
# than resumes, so --fetch-retries never helps. The payload does arrive; the TLS
# teardown is what breaks.
#
# Measured: --http1.1 and --tlsv1.2 truncate too, at different offsets each
# time, so it is not a protocol setting. curl -C - is the only thing that gets
# through, and `npm cache add` then satisfies npm's integrity check by content.
#
# Cost so far: next (41 MB), @next/swc (34 MB), react-native (~100 MB).
#
# Usage:  scripts/seed-npm-cache.sh <package> <version>
#         scripts/seed-npm-cache.sh react-native 0.85.3
#         scripts/seed-npm-cache.sh @next/swc-win32-x64-msvc 16.3.4

set -u
pkg="${1:?package name}"; ver="${2:?version}"

# Scoped names live at /@scope/name/-/name-version.tgz
base="${pkg##*/}"
url="https://registry.npmjs.org/${pkg}/-/${base}-${ver}.tgz"
out="${TEMP:-/tmp}/npmseed-${base}-${ver}.tgz"

echo "seeding ${pkg}@${ver}"
rm -f "$out"
for i in $(seq 1 30); do
  before=$(stat -c%s "$out" 2>/dev/null || echo 0)
  curl -sS -C - -o "$out" "$url" >/dev/null 2>&1
  after=$(stat -c%s "$out" 2>/dev/null || echo 0)
  if gzip -t "$out" 2>/dev/null; then
    echo "  complete at ${after} bytes after ${i} pass(es)"
    npm cache add "$out" >/dev/null 2>&1 && echo "  cached" || { echo "  npm cache add FAILED"; exit 1; }
    exit 0
  fi
  [ "$before" = "$after" ] && stalled=$((${stalled:-0} + 1)) || stalled=0
  if [ "${stalled:-0}" -ge 4 ]; then echo "  no progress after 4 passes at ${after} bytes"; exit 1; fi
done
echo "  gave up, still incomplete"
exit 1
