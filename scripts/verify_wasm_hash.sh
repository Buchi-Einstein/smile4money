#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "Usage: $0 <contract-id> <wasm-path> <network> <rpc-url> <network-passphrase>" >&2
  exit 2
fi

CONTRACT_ID="$1"
WASM_PATH="$2"
NETWORK="$3"
RPC_URL="$4"
NETWORK_PASSPHRASE="$5"

if [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: WASM artifact not found: $WASM_PATH" >&2
  exit 1
fi

LOCAL_HASH=$(sha256sum "$WASM_PATH" | awk '{print $1}')

if ! INSPECTION=$(stellar contract inspect \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" 2>&1); then
  echo "Error: failed to fetch WASM hash for contract $CONTRACT_ID from $NETWORK." >&2
  echo "$INSPECTION" >&2
  exit 1
fi

NETWORK_HASH=$(printf '%s\n' "$INSPECTION" | awk '$1 == "wasm_hash:" { print tolower($2); exit }')
if [[ ! "$NETWORK_HASH" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Error: stellar contract inspect returned no valid wasm_hash for contract $CONTRACT_ID." >&2
  echo "$INSPECTION" >&2
  exit 1
fi

if [[ "$LOCAL_HASH" != "$NETWORK_HASH" ]]; then
  echo "Error: deployed WASM hash mismatch for contract $CONTRACT_ID." >&2
  echo "  Local SHA-256:   $LOCAL_HASH" >&2
  echo "  Network wasm_hash: $NETWORK_HASH" >&2
  exit 1
fi

echo "WASM hash verified for $CONTRACT_ID:"
echo "  Local SHA-256:   $LOCAL_HASH"
echo "  Network wasm_hash: $NETWORK_HASH"