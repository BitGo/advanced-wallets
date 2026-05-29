#!/bin/bash

set -e

echo "Running integration tests..."

docker-compose -f docker-compose.integ.yml up --build --abort-on-container-exit || true

exit_code=$?

docker-compose -f docker-compose.integ.yml down

exit $exit_code
