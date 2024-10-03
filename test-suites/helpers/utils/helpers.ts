import { expect } from 'chai';
import { logger, utils, Contract } from 'ethers';
import { BigNumber } from '@ethersproject/bignumber';
import { TransactionReceipt } from '@ethersproject/providers';
import { getContract } from '../../../helpers/utilities/tx';
import {
  getMintableERC20,
  getRSToken,
  getStableDebtToken,
  getVariableDebtToken,
  getIRStrategy,
} from '../../../helpers/contract-getters';
import { tEthereumAddress } from '../../../helpers/types';
import { RSToken, ProtocolDataProvider, Pool } from '../../../types';
import { ReserveData, UserReserveData } from './interfaces';

export const getReserveData = async (
  helper: ProtocolDataProvider,
  reserve: tEthereumAddress
): Promise<ReserveData> => {
  const [reserveData, tokenAddresses, irStrategyAddress, reserveConfiguration, token] =
    await Promise.all([
      helper.getReserveData(reserve),
      helper.getReserveTokensAddresses(reserve),
      helper.getInterestRateStrategyAddress(reserve),
      helper.getReserveConfigurationData(reserve),
      getContract('IERC20Detailed', reserve),
    ]);

  const stableDebtToken = await getStableDebtToken(tokenAddresses.stableDebtTokenAddress);
  const variableDebtToken = await getVariableDebtToken(tokenAddresses.variableDebtTokenAddress);
  const irStrategy = await getIRStrategy(irStrategyAddress);

  const baseStableRate = await irStrategy.getBaseStableBorrowRate();

  const { 0: principalStableDebt } = await stableDebtToken.getSupplyData();
  const totalStableDebtLastUpdated = await stableDebtToken.getTotalSupplyLastUpdated();

  const scaledVariableDebt = await variableDebtToken.scaledTotalSupply();

  const symbol = await token.symbol();
  const decimals = BigNumber.from(await token.decimals());

  const accruedToTreasuryScaled = reserveData.accruedToTreasuryScaled;
  const unbacked = reserveData.unbacked;
  const RSToken = (await getRSToken(tokenAddresses.RSTokenAddress)) as RSToken;

  // Need the reserve factor
  const reserveFactor = reserveConfiguration.reserveFactor;

  const availableLiquidity = await token.balanceOf(RSToken.address);

  const totalLiquidity = availableLiquidity.add(unbacked);

  const totalDebt = reserveData.totalStableDebt.add(reserveData.totalVariableDebt);

  const borrowUsageRatio = totalDebt.eq(0)
    ? BigNumber.from(0)
    : totalDebt.rayDiv(availableLiquidity.add(totalDebt));

  let supplyUsageRatio = totalDebt.eq(0)
    ? BigNumber.from(0)
    : totalDebt.rayDiv(totalLiquidity.add(totalDebt));

  expect(supplyUsageRatio).to.be.lte(borrowUsageRatio, 'Supply usage ratio > borrow usage ratio');

  return {
    reserveFactor,
    unbacked,
    accruedToTreasuryScaled,
    availableLiquidity,
    totalLiquidity,
    borrowUsageRatio,
    supplyUsageRatio,
    totalStableDebt: reserveData.totalStableDebt,
    totalVariableDebt: reserveData.totalVariableDebt,
    liquidityRate: reserveData.liquidityRate,
    variableBorrowRate: reserveData.variableBorrowRate,
    stableBorrowRate: reserveData.stableBorrowRate,
    averageStableBorrowRate: reserveData.averageStableBorrowRate,
    liquidityIndex: reserveData.liquidityIndex,
    variableBorrowIndex: reserveData.variableBorrowIndex,
    lastUpdateTimestamp: BigNumber.from(reserveData.lastUpdateTimestamp),
    totalStableDebtLastUpdated: BigNumber.from(totalStableDebtLastUpdated),
    principalStableDebt: principalStableDebt,
    scaledVariableDebt: scaledVariableDebt,
    address: reserve,
    RSTokenAddress: tokenAddresses.RSTokenAddress,
    symbol,
    decimals,
    marketStableRate: BigNumber.from(baseStableRate),
  };
};

export const getUserData = async (
  pool: Pool,
  helper: ProtocolDataProvider,
  reserve: string,
  user: tEthereumAddress,
  sender?: tEthereumAddress
): Promise<UserReserveData> => {
  const [userData, scaledRSTokenBalance] = await Promise.all([
    helper.getUserReserveData(reserve, user),
    getRSTokenUserData(reserve, user, helper),
  ]);

  const token = await getMintableERC20(reserve);
  const walletBalance = await token.balanceOf(sender || user);

  return {
    scaledRSTokenBalance: BigNumber.from(scaledRSTokenBalance),
    currentRSTokenBalance: userData.currentRSTokenBalance,
    currentStableDebt: userData.currentStableDebt,
    currentVariableDebt: userData.currentVariableDebt,
    principalStableDebt: userData.principalStableDebt,
    scaledVariableDebt: userData.scaledVariableDebt,
    stableBorrowRate: userData.stableBorrowRate,
    liquidityRate: userData.liquidityRate,
    usageAsCollateralEnabled: userData.usageAsCollateralEnabled,
    stableRateLastUpdated: BigNumber.from(userData.stableRateLastUpdated),
    walletBalance,
  };
};

const getRSTokenUserData = async (
  reserve: string,
  user: string,
  helpersContract: ProtocolDataProvider
) => {
  const RSTokenAddress: string = (await helpersContract.getReserveTokensAddresses(reserve))
    .RSTokenAddress;

  const RSToken = await getRSToken(RSTokenAddress);

  const scaledBalance = await RSToken.scaledBalanceOf(user);
  return scaledBalance.toString();
};

export const matchEvent = (
  receipt: TransactionReceipt,
  name: string,
  eventContract: Contract,
  emitterAddress?: string,
  expectedArgs?: any[]
) => {
  const events = receipt.logs;

  if (events != undefined) {
    // match name from list of events in eventContract, when found, compute the sigHash
    let sigHash: string | undefined;
    for (let contractEvent of Object.keys(eventContract.interface.events)) {
      if (contractEvent.startsWith(name) && contractEvent.charAt(name.length) == '(') {
        sigHash = utils.keccak256(utils.toUtf8Bytes(contractEvent));
        break;
      }
    }
    // Throw if the sigHash was not found
    if (!sigHash) {
      logger.throwError(
        `Event "${name}" not found in provided contract. \nAre you sure you're using the right contract?`
      );
    }

    // Find the given event in the emitted logs
    let invalidParamsButExists = false;
    for (let emittedEvent of events) {
      // If we find one with the correct sigHash, check if it is the one we're looking for
      if (emittedEvent.topics[0] == sigHash) {
        // If an emitter address is passed, validate that this is indeed the correct emitter, if not, continue
        if (emitterAddress) {
          if (emittedEvent.address != emitterAddress) continue;
        }
        const event = eventContract.interface.parseLog(emittedEvent);
        // If there are expected arguments, validate them, otherwise, return here
        if (expectedArgs) {
          if (expectedArgs.length != event.args.length) {
            logger.throwError(
              `Event "${name}" emitted with correct signature, but expected args are of invalid length`
            );
          }
          invalidParamsButExists = false;
          // Iterate through arguments and check them, if there is a mismatch, continue with the loop
          for (let i = 0; i < expectedArgs.length; i++) {
            // Parse empty arrays as empty bytes
            if (expectedArgs[i].constructor == Array && expectedArgs[i].length == 0) {
              expectedArgs[i] = '0x';
            }

            // Break out of the expected args loop if there is a mismatch, this will continue the emitted event loop
            if (BigNumber.isBigNumber(event.args[i])) {
              if (!event.args[i].eq(BigNumber.from(expectedArgs[i]))) {
                invalidParamsButExists = true;
                break;
              }
            } else if (event.args[i].constructor == Array) {
              let params = event.args[i];
              let expected = expectedArgs[i];
              for (let j = 0; j < params.length; j++) {
                if (BigNumber.isBigNumber(params[j])) {
                  if (!params[j].eq(BigNumber.from(expected[j]))) {
                    invalidParamsButExists = true;
                    break;
                  }
                } else if (params[j] != expected[j]) {
                  invalidParamsButExists = true;
                  break;
                }
              }
              if (invalidParamsButExists) break;
            } else if (event.args[i] != expectedArgs[i]) {
              invalidParamsButExists = true;
              break;
            }
          }
          // Return if the for loop did not cause a break, so a match has been found, otherwise proceed with the event loop
          if (!invalidParamsButExists) {
            return;
          }
        } else {
          return;
        }
      }
    }
    // Throw if the event args were not expected or the event was not found in the logs
    if (invalidParamsButExists) {
      logger.throwError(`Event "${name}" found in logs but with unexpected args`);
    } else {
      logger.throwError(
        `Event "${name}" not found emitted by "${emitterAddress}" in given transaction log`
      );
    }
  } else {
    logger.throwError('No events were emitted');
  }
};
