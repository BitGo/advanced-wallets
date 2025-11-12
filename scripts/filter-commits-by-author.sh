#!/bin/bash
#
# Filter commits by author for commitlint validation
# This script identifies commits between two refs and excludes commits from specified authors
#
# Usage: ./filter-commits-by-author.sh <from_sha> <to_sha> [excluded_authors]
#
# Arguments:
#   from_sha: Base commit SHA to start from
#   to_sha: Head commit SHA to validate up to
#   excluded_authors: Comma-separated list of author emails or names to exclude (optional)
#
# Example:
#   ./filter-commits-by-author.sh abc123 def456 "bot@example.com,dependabot[bot]"

set -e

FROM_SHA="$1"
TO_SHA="$2"
EXCLUDED_AUTHORS="${3:-}"

if [ -z "$FROM_SHA" ] || [ -z "$TO_SHA" ]; then
  echo "Error: FROM_SHA and TO_SHA are required"
  echo "Usage: $0 <from_sha> <to_sha> [excluded_authors]"
  exit 1
fi

# Get the list of all commits between FROM_SHA and TO_SHA
ALL_COMMITS=$(git rev-list --reverse "${FROM_SHA}..${TO_SHA}")

if [ -z "$ALL_COMMITS" ]; then
  echo "No commits found between $FROM_SHA and $TO_SHA"
  exit 0
fi

# If no excluded authors are specified, validate all commits
if [ -z "$EXCLUDED_AUTHORS" ]; then
  echo "No author filtering specified. Validating all commits:"
  for commit in $ALL_COMMITS; do
    echo "  - $(git log -1 --format='%h %s' "$commit")"
  done
  echo ""
  echo "Running commitlint on commits from $FROM_SHA to $TO_SHA"
  npx commitlint --from "$FROM_SHA" --to "$TO_SHA" --verbose
  exit 0
fi

# Convert comma-separated list to array
IFS=',' read -ra EXCLUDED_ARRAY <<< "$EXCLUDED_AUTHORS"

# Filter commits by author
FILTERED_COMMITS=""
EXCLUDED_COUNT=0

for commit in $ALL_COMMITS; do
  AUTHOR=$(git log -1 --format='%ae' "$commit")
  AUTHOR_NAME=$(git log -1 --format='%an' "$commit")
  
  SHOULD_EXCLUDE=false
  for excluded in "${EXCLUDED_ARRAY[@]}"; do
    # Trim whitespace
    excluded=$(echo "$excluded" | xargs)
    
    # Check if author email or name matches the excluded pattern
    if [[ "$AUTHOR" == *"$excluded"* ]] || [[ "$AUTHOR_NAME" == *"$excluded"* ]]; then
      SHOULD_EXCLUDE=true
      break
    fi
  done
  
  if [ "$SHOULD_EXCLUDE" = false ]; then
    FILTERED_COMMITS="$FILTERED_COMMITS $commit"
  else
    echo "Excluding commit $commit from $AUTHOR_NAME <$AUTHOR>"
    EXCLUDED_COUNT=$((EXCLUDED_COUNT + 1))
  fi
done

# Remove leading space
FILTERED_COMMITS=$(echo "$FILTERED_COMMITS" | xargs)

echo ""
echo "Excluded $EXCLUDED_COUNT commit(s) from authors matching: $EXCLUDED_AUTHORS"
echo ""

# If no commits remain after filtering, exit successfully
if [ -z "$FILTERED_COMMITS" ]; then
  echo "No commits to validate after filtering"
  exit 0
fi

echo "Validating the following commits:"
for commit in $FILTERED_COMMITS; do
  echo "  - $(git log -1 --format='%h %s (%an)' "$commit")"
done

echo ""
echo "Running commitlint on filtered commits..."

# Validate each filtered commit individually
FAILED=0
for commit in $FILTERED_COMMITS; do
  if ! npx commitlint --from "${commit}~1" --to "$commit" --verbose; then
    FAILED=1
  fi
done

if [ $FAILED -eq 1 ]; then
  echo ""
  echo "Commitlint validation failed for one or more commits"
  exit 1
fi

echo ""
echo "All filtered commits passed commitlint validation"
exit 0
