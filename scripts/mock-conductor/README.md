# Mock OSO conductor

Polls the FE plugin for documents, forwards to the BE plugin, then returns results to FE. HTTP by default.

## Setup

```bash
pip install -r scripts/mock-conductor/requirements.txt
cp scripts/mock-conductor/.env.example scripts/mock-conductor/.env
```

Edit `.env` with your FE/BE plugin hostnames and ports.

## Run

From the repo root:

```bash
set -a && source scripts/mock-conductor/.env && set +a
python3 scripts/mock-conductor/mock_conductor.py
```

`Connection refused` means the plugins aren't running yet — expected until the full local stack is up.
