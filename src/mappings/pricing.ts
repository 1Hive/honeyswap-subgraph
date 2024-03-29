/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { log } from '@graphprotocol/graph-ts'
import { BigDecimal, Address, BigInt, dataSource } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from './helpers'
import {
  getDaiNativeCurrencyWrapperPairAddress,
  getUsdcNativeCurrencyWrapperPairAddress,
  getUsdtNativeCurrencyWrapperPair,
  getNativeCurrencyWrapperAddress,
  getLiquidityTrackingTokenAddresses
} from '../commons/addresses'
import { getMinimumLiquidityThresholdNativeCurrency, getMinimumUsdThresholdForNewPairs } from '../commons/pricing'

export function getNativeCurrencyPriceInUSD(): BigDecimal {
  if (dataSource.network() == 'gnosis') {
    return ONE_BD
  }

  // fetch native currency prices for each stablecoin
  let daiPair = Pair.load(getDaiNativeCurrencyWrapperPairAddress()) // dai is token1
  let usdcPair = Pair.load(getUsdcNativeCurrencyWrapperPairAddress()) // usdc is token1
  let usdtPair = Pair.load(getUsdtNativeCurrencyWrapperPair()) // usdt is token1

  // all 3 have been created
  if (daiPair !== null && usdcPair !== null && usdtPair !== null) {
    let totalLiquidityNativeCurrency = daiPair.reserve0.plus(usdcPair.reserve0).plus(usdtPair.reserve0)
    let daiWeight = daiPair.reserve0.div(totalLiquidityNativeCurrency)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityNativeCurrency)
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityNativeCurrency)
    return daiPair.token1Price
      .times(daiWeight)
      .plus(usdcPair.token1Price.times(usdcWeight))
      .plus(usdtPair.token1Price.times(usdtWeight))
    // dai and USDC have been created
  } else if (daiPair !== null && usdcPair !== null) {
    let totalLiquidityNativeCurrency = daiPair.reserve0.plus(usdcPair.reserve0)
    let daiWeight = daiPair.reserve0.div(totalLiquidityNativeCurrency)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityNativeCurrency)
    return daiPair.token1Price.times(daiWeight).plus(usdcPair.token1Price.times(usdcWeight))
    // USDC is the only pair so far
  } else if (usdcPair !== null) {
    return usdcPair.token1Price
  } else {
    return ZERO_BD
  }
}

/**
 * Search through graph to find derived native currency per token.
 * @todo update to be derived native currency (add stablecoin estimates)
 **/
export function findNativeCurrencyPerToken(token: Token): BigDecimal {
  if (token.id == getNativeCurrencyWrapperAddress()) {
    return ONE_BD
  }
  let whitelist = getLiquidityTrackingTokenAddresses()
  // loop through whitelist and check if paired with any
  for (let i = 0; i < whitelist.length; i++) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(whitelist[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())

      if (
        pair &&
        pair.token0 == token.id &&
        pair.reserveNativeCurrency.gt(getMinimumLiquidityThresholdNativeCurrency())
      ) {
        let token1 = Token.load(pair.token1)
        if (token1) {
          return pair.token1Price.times(token1.derivedNativeCurrency as BigDecimal) // return token1 per our token * native currency per token 1
        }
      }
      if (
        pair &&
        pair.token1 == token.id &&
        pair.reserveNativeCurrency.gt(getMinimumLiquidityThresholdNativeCurrency())
      ) {
        let token0 = Token.load(pair.token0)
        if (token0) {
          return pair.token0Price.times(token0.derivedNativeCurrency as BigDecimal) // return token0 per our token * native currency per token 0
        }
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')

  let price0 = BigDecimal.zero()
  let price1 = BigDecimal.zero()

  if (bundle && token0.derivedNativeCurrency && token1.derivedNativeCurrency) {
    price0 = token0.derivedNativeCurrency!.times(bundle.nativeCurrencyPrice)
    price1 = token1.derivedNativeCurrency!.times(bundle.nativeCurrencyPrice)
  }

  log.info('pair.id {}', [pair.id])
  let whitelist = getLiquidityTrackingTokenAddresses()
  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    log.info('lt provider count 5 {}', [pair.id])
    log.info('price0 {}', [price0.toString()])
    log.info('price1 {}', [price1.toString()])
    if (whitelist.includes(token0.id) && whitelist.includes(token1.id)) {
      log.info('both in whitelist {}', [pair.id.toString()])
      if (reserve0USD.plus(reserve1USD).lt(getMinimumUsdThresholdForNewPairs())) {
        log.info('zeroing less threshold {}', [pair.id.toString()])
        return ZERO_BD
      }
    }
    if (whitelist.includes(token0.id) && !whitelist.includes(token1.id)) {
      log.info('token0 in and token1 out of whitelist {}', [pair.id.toString()])
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(getMinimumUsdThresholdForNewPairs())) {
        log.info('reserver0USD times 2 less threshold {}', [pair.id.toString()])
        return ZERO_BD
      }
    }
    if (!whitelist.includes(token0.id) && whitelist.includes(token1.id)) {
      log.info('token0 in and token1 out of whitelist {}', [pair.id.toString()])
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(getMinimumUsdThresholdForNewPairs())) {
        log.info('reserver1USD times 2 less threshold {}', [pair.id.toString()])
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (whitelist.includes(token0.id) && whitelist.includes(token1.id)) {
    log.info('both in {} {} {} {}', [
      tokenAmount0.toString(),
      price0.toString(),
      tokenAmount1.toString(),
      price1.toString()
    ])
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (whitelist.includes(token0.id) && !whitelist.includes(token1.id)) {
    log.info('token0 in and token1 out {} {}', [tokenAmount0.toString(), price0.toString()])
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!whitelist.includes(token0.id) && whitelist.includes(token1.id)) {
    log.info('token0 out and token1 in whitelist {} {}', [tokenAmount0.toString(), price0.toString()])
    return tokenAmount1.times(price1)
  }

  log.info('Not IFs so ZERO {}', [pair.id.toString()])
  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')

  let price0 = BigDecimal.zero()
  let price1 = BigDecimal.zero()

  if (bundle && token0.derivedNativeCurrency && token1.derivedNativeCurrency) {
    price0 = token0.derivedNativeCurrency!.times(bundle.nativeCurrencyPrice)
    price1 = token1.derivedNativeCurrency!.times(bundle.nativeCurrencyPrice)
  }

  let whitelist = getLiquidityTrackingTokenAddresses()
  // both are whitelist tokens, take average of both amounts
  if (whitelist.includes(token0.id) && whitelist.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (whitelist.includes(token0.id) && !whitelist.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!whitelist.includes(token0.id) && whitelist.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
