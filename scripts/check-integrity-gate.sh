#!/usr/bin/env bash
# The write gate: inserts into supply_chain_events / claim_evidence /
# evidence may exist ONLY in lib/engine/persist.ts. Everything else must go
# through persistEvent/persistEvidence, which refuse sourceless claims.
set -euo pipefail
cd "$(dirname "$0")/.."

violations=0
for table in supplyChainEvents claimEvidence "insert(evidence)" ; do
  pattern="insert(${table}"
  [ "$table" = "insert(evidence)" ] && pattern="insert(evidence)"
  hits=$(grep -rn --include='*.ts' --include='*.tsx' -F "$pattern" \
    app components lib db providers scripts 2>/dev/null \
    | grep -v 'lib/engine/persist.ts' \
    | grep -v '\.test\.ts' || true)
  # Allow schema.X qualified forms too.
  hits2=$(grep -rn --include='*.ts' --include='*.tsx' -E "insert\((schema\.)?${table}\)" \
    app components lib db providers scripts 2>/dev/null \
    | grep -v 'lib/engine/persist.ts' \
    | grep -v '\.test\.ts' || true)
  combined=$(printf '%s\n%s' "$hits" "$hits2" | sort -u | sed '/^$/d')
  if [ -n "$combined" ]; then
    echo "GATE VIOLATION — direct insert of ${table} outside persist.ts:"
    echo "$combined"
    violations=1
  fi
done

if [ "$violations" -ne 0 ]; then
  exit 1
fi
echo "Integrity gate clean: graph writes only in lib/engine/persist.ts"
