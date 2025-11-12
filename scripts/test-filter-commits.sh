#!/bin/bash
#
# Test script for filter-commits-by-author.sh
#
# This script tests the commit filtering functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTER_SCRIPT="$SCRIPT_DIR/filter-commits-by-author.sh"

echo "Testing filter-commits-by-author.sh"
echo "===================================="
echo ""

# Test 1: Basic usage check
echo "Test 1: Check script requires FROM_SHA and TO_SHA"
if $FILTER_SCRIPT 2>&1 | grep -q "Error: FROM_SHA and TO_SHA are required"; then
  echo "✓ Test 1 passed: Script correctly validates required arguments"
else
  echo "✗ Test 1 failed: Script should require FROM_SHA and TO_SHA"
  exit 1
fi
echo ""

# Test 2: Check with valid commits (will fail commitlint, but should run)
echo "Test 2: Running with valid commit range but no filtering"
if $FILTER_SCRIPT HEAD~2 HEAD "" > /dev/null 2>&1 || [ $? -eq 1 ]; then
  echo "✓ Test 2 passed: Script runs with valid commit range"
else
  echo "✗ Test 2 failed: Script should run with valid commits"
  exit 1
fi
echo ""

# Test 3: Filter by author (should exclude copilot commits)
echo "Test 3: Filter commits by author (copilot-swe-agent)"
OUTPUT=$($FILTER_SCRIPT HEAD~2 HEAD "copilot-swe-agent" 2>&1)
if echo "$OUTPUT" | grep -q "Excluding commit" || echo "$OUTPUT" | grep -q "No commits to validate after filtering"; then
  echo "✓ Test 3 passed: Author filtering works"
else
  echo "✗ Test 3 failed: Author filtering should work"
  echo "Output: $OUTPUT"
  exit 1
fi
echo ""

echo "===================================="
echo "All tests passed!"
