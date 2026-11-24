#!/usr/bin/env bash
# GitHub Ubuntu runners only: use distro-signed FFmpeg/FFprobe packages.
set -euo pipefail

rtl_ubuntu_archive_sources() {
  # Only rewrite the observed slow regional EC2 mirror, on a deb822 URIs
  # field. Leave security, suites, components, Signed-By and other repos alone.
  sed -E 's#^([[:space:]]*URIs:[[:space:]]+)https?://us-east-2\.ec2\.archive\.ubuntu\.com/ubuntu/?([[:space:]]|$)#\1https://archive.ubuntu.com/ubuntu/\2#' "$1"
}

rtl_install_linux_ffmpeg() (
  if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
    local source_file=/etc/apt/sources.list.d/ubuntu.sources rewritten
    local -a apt_options=(-o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
    if [[ -f "$source_file" ]]; then
      rewritten="$(mktemp)"
      trap 'rm -f "$rewritten"' EXIT
      rtl_ubuntu_archive_sources "$source_file" > "$rewritten"
      if ! cmp -s "$source_file" "$rewritten"; then
        echo 'Replacing slow EC2 Ubuntu mirror with official Ubuntu archive (signed indexes retained).'
        sudo tee "$source_file" < "$rewritten" >/dev/null
        # A changed URI requires fresh signed package indexes before install.
        sudo apt-get "${apt_options[@]}" update
      fi
    fi
    if ! sudo apt-get "${apt_options[@]}" install -y --no-install-recommends ffmpeg; then
      sudo apt-get "${apt_options[@]}" update
      sudo apt-get "${apt_options[@]}" install -y --no-install-recommends ffmpeg
    fi
  fi
  ffmpeg -hide_banner -version
  ffprobe -hide_banner -version
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rtl_install_linux_ffmpeg
fi
