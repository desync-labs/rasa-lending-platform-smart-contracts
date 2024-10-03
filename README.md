# RASA Lending Protocol

This repository contains the smart contracts source code and markets configuration for RASA Lending Protocol. The repository uses Docker Compose and Hardhat as development environment for compilation, testing and deployment tasks.

## What is RASA Lending?

RASA Lending is a decentralized non-custodial liquidity markets protocol where users can participate as suppliers or borrowers. Suppliers provide liquidity to the market to earn a passive income, while borrowers are able to borrow in an overcollateralized (perpetually) or undercollateralized (one-block liquidity) fashion.

## Documentation

## Audits and Formal Verification

## Getting Started

## Setup

The repository uses Docker Compose to manage sensitive keys and load the configuration. Prior to any action like test or deploy, you must run `docker-compose up` to start the `contracts-env` container, and then connect to the container console via `docker-compose exec contracts-env bash`.

Follow the next steps to setup the repository:

- Install `docker` and `docker-compose`
- Create an environment file named `.env` and fill the next environment variables

```
# Add Alchemy or Infura provider keys, alchemy takes preference at the config level
ALCHEMY_KEY=""
INFURA_KEY=""


# Optional, if you plan to use Tenderly scripts
TENDERLY_PROJECT=""
TENDERLY_USERNAME=""

```

## Test

You can run the full test suite with the following commands:

npm run test

## Adding Collaterals

# Step 1
add new strategy configuration in  `/markents/{network}/reservesConfigs.ts`

# Step 2
add collateral to the market configuration in `/markents/{network}/index.ts`
new data should be added to `ReservesConfig`, `ReserveAssets` and `PriceAggregators`

note: be sure RASAOracle.sol contract subscribed to the price aggregator

# Step 3
`run npm add-reserves:{network}` for example `run npm add-reserves:sepolia`

