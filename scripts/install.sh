#!/bin/sh
# macOS installer: downloads the release manifest, VERIFIES it (RSA-3072/SHA-256 signature over SHA256SUMS, then the
# manifest's hash) and copies it to Word's sideload folder. Restart Word, then Insert > Add-ins > My Add-ins > Developer Add-ins.
# Usage: sh install.sh [vX.Y.Z]     (default: latest release; pin a tag to avoid silent upgrades)
set -eu
REPO="A-N-O-D-E-R/legal-anonymiser-mvp"
TAG="${1:-latest}"
# Release public key, pinned in this script (written by scripts/keygen.mjs).
PUBKEY='__RELEASE_PUBKEY__'
die() { echo "REFUSING TO INSTALL: $*" >&2; exit 1; }
case "$PUBKEY" in *BEGIN\ PUBLIC\ KEY*) ;; *) die "no release signing key is pinned in this script" ;; esac

if [ "$TAG" = latest ]; then base="https://github.com/$REPO/releases/latest/download"; else base="https://github.com/$REPO/releases/download/$TAG"; fi
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
for f in SHA256SUMS SHA256SUMS.sig manifest.prod.xml; do curl -fsSL "$base/$f" -o "$t/$f" || die "cannot download $f"; done
printf '%s\n' "$PUBKEY" > "$t/key.pem"
openssl dgst -sha256 -verify "$t/key.pem" -signature "$t/SHA256SUMS.sig" "$t/SHA256SUMS" >/dev/null || die "bad signature on SHA256SUMS"
want="$(awk '$2=="manifest.prod.xml"{print $1}' "$t/SHA256SUMS")"
got="$(shasum -a 256 "$t/manifest.prod.xml" | awk '{print $1}')"
[ -n "$want" ] && [ "$want" = "$got" ] || die "manifest.prod.xml hash does not match the signed SHA256SUMS"

d="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
mkdir -p "$d"
cp "$t/manifest.prod.xml" "$d/legal-anonymiser.xml"
echo "Signature and hash verified ($TAG). Done. Restart Word."
