#!/usr/bin/env python3
"""Mock OSO conductor for local E2E testing.

Polls the FE plugin for pending OsoDocuments, forwards them to the BE plugin,
then collects completed results from BE and returns them to FE.
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

from jsonschema import ValidationError, validate

FRONTEND_HOST = os.environ["FRONTEND_HOST"]
FRONTEND_PORT = os.environ.get("FRONTEND_PORT", "4000")
BACKEND_HOST = os.environ["BACKEND_HOST"]
BACKEND_PORT = os.environ.get("BACKEND_PORT", "4000")

POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "1"))
TRANSFER_DELAY = float(os.environ.get("TRANSFER_DELAY", "0.5"))

USE_TLS = os.environ.get("USE_TLS", "false").lower() in ("1", "true", "yes")
CLIENT_CERT = os.environ.get("CLIENT_CERT", "testerdata/user.crt")
CLIENT_KEY = os.environ.get("CLIENT_KEY", "testerdata/user.key")
CA_CERT = os.environ.get("CA_CERT")

SCHEME = "https" if USE_TLS else "http"

FRONTEND_URL = f"{SCHEME}://{FRONTEND_HOST}:{FRONTEND_PORT}/api/frontend/v1alpha1/documents"
BACKEND_URL = f"{SCHEME}://{BACKEND_HOST}:{BACKEND_PORT}/api/backend/v1alpha1/documents"
FRONTEND_STATUS_URL = (
    f"{SCHEME}://{FRONTEND_HOST}:{FRONTEND_PORT}/api/frontend/v1alpha1/status"
)
BACKEND_STATUS_URL = (
    f"{SCHEME}://{BACKEND_HOST}:{BACKEND_PORT}/api/backend/v1alpha1/status"
)


def _build_ssl_context() -> ssl.SSLContext | None:
    if not USE_TLS:
        return None
    ctx = ssl.create_default_context()
    if CA_CERT:
        ctx.load_verify_locations(CA_CERT)
    else:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    ctx.load_cert_chain(certfile=CLIENT_CERT, keyfile=CLIENT_KEY)
    return ctx


SSL_CONTEXT = _build_ssl_context()

ERROR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["code", "message"],
    "properties": {
        "code": {"type": "string"},
        "message": {"type": "string"},
    },
    "additionalProperties": True,
}

COMPONENT_STATUS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {"type": "string"},
        "errors": {"type": "array", "items": ERROR_SCHEMA},
    },
    "additionalProperties": True,
}

DOCUMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["id", "content"],
    "properties": {
        "id": {"type": "string", "format": "uuid"},
        "content": {"type": "string"},
        "signature": {"type": "string"},
        "metadata": {"type": "string"},
    },
    "additionalProperties": True,
}

DOCUMENTS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["documents", "count"],
    "properties": {
        "documents": {"type": "array", "items": DOCUMENT_SCHEMA},
        "count": {"type": "integer"},
    },
}


def validate_documents(payload: dict[str, Any]) -> bool:
    try:
        validate(instance=payload, schema=DOCUMENTS_SCHEMA)
        for doc in payload.get("documents", []):
            uuid.UUID(doc["id"])
        return True
    except (ValidationError, ValueError) as e:
        print("[SCHEMA ERROR]", e, file=sys.stderr)
        return False


def validate_component_status(payload: dict[str, Any]) -> bool:
    try:
        validate(instance=payload, schema=COMPONENT_STATUS_SCHEMA)
        return True
    except ValidationError as e:
        print("[STATUS SCHEMA ERROR]", e, file=sys.stderr)
        return False


def _urlopen(req: urllib.request.Request) -> Any:
    return urllib.request.urlopen(req, context=SSL_CONTEXT)


def _status(url: str, label: str) -> dict[str, Any] | None:
    try:
        req = urllib.request.Request(url, method="GET")
        with _urlopen(req) as resp:
            data = json.loads(resp.read())
            if validate_component_status(data):
                print(f"[STATUS OK] {label}: {data.get('status', 'ok')}")
                return data
            print(f"[STATUS INVALID] {label}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"[STATUS ERROR] {label} {url}: {e}", file=sys.stderr)
        return None


def _get(url: str) -> list[dict[str, Any]] | None:
    try:
        req = urllib.request.Request(url, method="GET")
        with _urlopen(req) as resp:
            body = resp.read()
            if not body:
                return None
            data = json.loads(body)
            if validate_documents(data):
                return data["documents"]
            print(f"[SCHEMA ERROR] invalid document payload from GET {url}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"[GET ERROR] {url}: {e}", file=sys.stderr)
        return None


def _post(url: str, docs: list[dict[str, Any]]) -> bool:
    data = json.dumps(docs).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with _urlopen(req) as resp:
            resp.read()
        return True
    except urllib.error.HTTPError as e:
        print(f"[POST ERROR] {url} failed: HTTP {e.code}", file=sys.stderr)
        return False
    except urllib.error.URLError as e:
        print(f"[POST ERROR] {url} unreachable: {e.reason}", file=sys.stderr)
        return False


def main() -> None:
    print("-----------------------------------------------------------")
    print(f"Mock conductor ({SCHEME.upper()}, poll={POLL_INTERVAL}s)")
    print("Checking system status...")
    _status(FRONTEND_STATUS_URL, "frontend")
    _status(BACKEND_STATUS_URL, "backend")
    print("-----------------------------------------------------------")
    print(f"Bridge polling: frontend={FRONTEND_URL}")
    print(f"                backend={BACKEND_URL}")
    print("-----------------------------------------------------------")

    while True:
        docs = _get(FRONTEND_URL)
        if docs:
            count = len(docs)
            if _post(BACKEND_URL, docs):
                print(f"[CYCLE] frontend docs={count} -> forwarded to backend")
            else:
                print(
                    f"[CYCLE] frontend docs={count} -> POST to backend failed",
                    file=sys.stderr,
                )

        time.sleep(TRANSFER_DELAY)

        docs = _get(BACKEND_URL)
        if docs:
            count = len(docs)
            if _post(FRONTEND_URL, docs):
                print(f"[CYCLE] backend docs={count} -> forwarded to frontend")
            else:
                print(
                    f"[CYCLE] backend docs={count} -> POST to frontend failed",
                    file=sys.stderr,
                )

        time.sleep(POLL_INTERVAL)
        print("-----------------------------------------------------------")


if __name__ == "__main__":
    main()
