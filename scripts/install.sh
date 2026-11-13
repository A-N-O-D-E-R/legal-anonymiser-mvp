#!/bin/sh
# macOS installer: copies the prod manifest to Word's sideload folder. Restart Word, then Insert > Add-ins > My Add-ins > Developer Add-ins.
set -e
d="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
mkdir -p "$d"
curl -fsSL https://github.com/A-N-O-D-E-R/legal-anonymiser-mvp/releases/latest/download/manifest.prod.xml -o "$d/legal-anonymiser.xml"
echo "Done. Restart Word."
