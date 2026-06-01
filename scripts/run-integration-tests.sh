#!/bin/bash

set -e

echo "Running integration tests..."

trap 'docker compose -f docker-compose.integ.yml down' EXIT

docker compose -f docker-compose.integ.yml up --build --abort-on-container-exit
