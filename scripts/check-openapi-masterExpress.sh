#!/usr/bin/env bash
set -euo pipefail

SPEC_FILE="masterBitgoExpress.json"
BEFORE="$(mktemp)"
trap 'rm -f "$BEFORE"' EXIT

if [ ! -f "$SPEC_FILE" ]; then
  echo "Error: $SPEC_FILE not found"
  exit 1
fi

cp "$SPEC_FILE" "$BEFORE"
npm run generate:openapi:masterExpress

if diff -q "$BEFORE" "$SPEC_FILE" > /dev/null; then
  echo "✅  OpenAPI spec is up to date."
  exit 0
fi

echo "::error::$SPEC_FILE is out of sync with route code."
diff "$BEFORE" "$SPEC_FILE" || true
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚨  OpenAPI spec drift detected!"
echo ""
echo "  ➤  To fix, run:"
echo ""
echo "       npm run generate:openapi:masterExpress"
echo "       git add masterBitgoExpress.json && git commit"
echo ""
echo "  ⚠️   Never hand-edit masterBitgoExpress.json directly."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 1
