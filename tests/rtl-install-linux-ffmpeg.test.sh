#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/rtl-install-linux-ffmpeg.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/input" <<'SOURCE'
# URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu/
Types: deb
URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu/
Suites: noble-security
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

URIs: https://us-east-2.ec2.archive.ubuntu.com/ubuntu
URIs: https://us-east-2.ec2.archive.ubuntu.com.example.org/ubuntu/
URIs: https://us-east-2.ec2.archive.ubuntu.com/ubuntu-other/
URIs: https://archive.ubuntu.com/ubuntu/
SOURCE
cat > "$work/expected" <<'EXPECTED'
# URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu/
Types: deb
URIs: https://archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu/
Suites: noble-security
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

URIs: https://archive.ubuntu.com/ubuntu/
URIs: https://us-east-2.ec2.archive.ubuntu.com.example.org/ubuntu/
URIs: https://us-east-2.ec2.archive.ubuntu.com/ubuntu-other/
URIs: https://archive.ubuntu.com/ubuntu/
EXPECTED
rtl_ubuntu_archive_sources "$work/input" > "$work/actual"
diff -u "$work/expected" "$work/actual"
rtl_ubuntu_archive_sources "$work/actual" > "$work/again"
diff -u "$work/actual" "$work/again"
echo 'PASS exact official mirror rewrite preserves signing and unrelated sources; replay is idempotent'
