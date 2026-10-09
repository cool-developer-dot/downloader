#!/usr/bin/env bash
# Run before building an AAB for Google Play. Refuses a build that testers could not install over the previous one,
# or that git could not reproduce later. Usage: bash scripts/release/check-release.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

fail() { echo "✘ $1" >&2; exit 1; }
ok() { echo "✔ $1"; }

branch=$(git branch --show-current)
[[ "$branch" == release/* ]] || fail "Play builds come from a release/* branch (you are on '$branch')."
ok "branch $branch"

[[ -z "$(git status --porcelain)" ]] || fail "Uncommitted changes: commit them first so this build can be rebuilt later."
ok "working tree clean"

gradle_code=$(sed -n 's/^[[:space:]]*versionCode \([0-9][0-9]*\).*/\1/p' android/app/build.gradle | head -1)
gradle_name=$(sed -n 's/^[[:space:]]*versionName "\(.*\)".*/\1/p' android/app/build.gradle | head -1)
json_code=$(node -p "require('./app.json').expo.android.versionCode")
json_name=$(node -p "require('./app.json').expo.version")
[[ "$gradle_code" == "$json_code" ]] || fail "versionCode differs: build.gradle $gradle_code, app.json $json_code."
[[ "$gradle_name" == "$json_name" ]] || fail "versionName differs: build.gradle $gradle_name, app.json $json_name."
ok "version $gradle_name ($gradle_code) matches in build.gradle and app.json"

# Every Play build's tag message records "versionCode N"; a code that was already shipped can never be uploaded again.
highest=$(git tag -l 'v*' --format='%(contents)' | sed -n 's/.*versionCode \([0-9][0-9]*\).*/\1/p' | sort -n | tail -1)
highest=${highest:-0}
(( gradle_code > highest )) || fail "versionCode $gradle_code is not above the last shipped $highest: bump it in build.gradle and app.json."
ok "versionCode $gradle_code > last shipped $highest"

props=${VIDORAX_UPLOAD_KEYSTORE_PROPERTIES:-$HOME/.vidorax-signing/keystore.properties}
[[ -f "$props" ]] || fail "Upload key not found ($props): the build would be unsigned and testers could not update."
ok "upload key present"

cat <<EOF

All checks passed. Next:
  1. bash scripts/dev/gradle.sh :app:bundleRelease
  2. Install it over the previous test build on a device that has downloads, and check nothing is lost.
  3. git tag -a v${gradle_name}-test<N> -m "VidoraX ${gradle_name} (versionCode ${gradle_code}) — <what changed>; AAB SHA-256 <sum>"
  4. git push origin $branch --tags, then upload the AAB to the same Play testing track.
EOF
