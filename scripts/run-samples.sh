#!/usr/bin/env bash
# Compiles every COBOL sample with GnuCOBOL and runs it on a few inputs.
# Usage: ./scripts/run-samples.sh
set -euo pipefail

cd "$(dirname "$0")/../cobol-samples"
mkdir -p bin

if ! command -v cobc >/dev/null 2>&1; then
  echo "cobc (GnuCOBOL) not found. Install it first (see README)." >&2
  exit 1
fi

for p in interest payroll tax; do
  cobc -x -free -o "bin/$p" "$p.cbl"
done

echo "== interest (1000, 5, 3) =="
printf '1000\n5\n3\n' | ./bin/interest
echo "== payroll (45, 20.55) =="
printf '45\n20.55\n' | ./bin/payroll
echo "== tax (750000) =="
printf '750000\n' | ./bin/tax
echo
echo "Compare against cobol-samples/EXPECTED.md"
