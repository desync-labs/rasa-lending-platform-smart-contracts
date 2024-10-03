#!/bin/bash

echo "[BASH] Setting up testnet environment"

if [ ! "$COVERAGE" = true ]; then
    # remove hardhat and artifacts cache
    npm run ci:clean
    npm run compile
else
    echo "[BASH] Skipping compilation to keep coverage artifacts"
fi

# Export MARKET_NAME variable to use market as testnet deployment setup
export MARKET_NAME="Test"
export ENABLE_REWARDS="false"
echo "[BASH] Testnet environment ready"