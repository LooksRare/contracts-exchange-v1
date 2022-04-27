# @looksrare/contracts-exchange-v1

## Description

This project contains all smart contracts used for the current LooksRare exchange ("v1"). This includes:

- core exchange contract
- libraries
- currency manager contract
- execution manager and strategy contracts
- royalty-related contracts
- transfer managers and selector contracts

## Installation

```shell
# Yarn
yarn add @looksrare/contracts-exchange-v1

# NPM
npm install @looksrare/contracts-exchange-v1
```

## NPM package

The NPM package contains the following:

- Solidity smart contracts (_".sol"_)
- ABI files (_".json"_)

## Documentation

The documentation for the exchange smart contracts is available [here](https://docs.looksrare.org/developers/category/exchange-contracts).

## About this repo

### Structure

It is a hybrid [Hardhat](https://hardhat.org/) repo that also requires [Foundry](https://book.getfoundry.sh/index.html) to run Solidity tests powered by the [ds-test library](https://github.com/dapphub/ds-test/).

> To install Foundry, please follow the instructions [here](https://book.getfoundry.sh/getting-started/installation.html).

### Run tests

- TypeScript tests are included in the `test` folder at the root of this repo.
- Solidity tests are included in the `test` folder in the `contracts` folder.

### Example of Foundry/Forge commands

```shell
forge build
forge test
forge test -vv
forge tree
```

### Example of Hardhat commands

```shell
npx hardhat accounts
npx hardhat compile
npx hardhat clean
npx hardhat test
npx hardhat node
npx hardhat help
REPORT_GAS=true npx hardhat test
npx hardhat coverage
npx hardhat run scripts/deploy.ts
TS_NODE_FILES=true npx ts-node scripts/deploy.ts
npx eslint '**/*.{js,ts}'
npx eslint '**/*.{js,ts}' --fix
npx prettier '**/*.{json,sol,md}' --check
npx prettier '**/*.{json,sol,md}' --write
npx solhint 'contracts/**/*.sol'
npx solhint 'contracts/**/*.sol' --fix
```
