/* eslint-disable prefer-const */
import { BigInt, BigDecimal, store, Address, log } from '@graphprotocol/graph-ts'
import {
  Pair,
  Token,
  HoneyswapFactory,
  Transaction,
  Mint as MintEvent,
  Burn as BurnEvent,
  Swap as SwapEvent,
  Bundle
} from '../types/schema'
import { Pair as PairContract, Mint, Burn, Swap, Transfer, Sync } from '../types/templates/Pair/Pair'
import { updatePairDayData, updateTokenDayData, updateHoneyswapDayData, updatePairHourData } from './dayUpdates'
import {
  getNativeCurrencyPriceInUSD,
  findNativeCurrencyPerToken,
  getTrackedVolumeUSD,
  getTrackedLiquidityUSD
} from './pricing'
import {
  convertTokenToDecimal,
  ADDRESS_ZERO,
  ONE_BI,
  createUser,
  createLiquidityPosition,
  ZERO_BD,
  BI_18,
  createLiquiditySnapshot
} from './helpers'
import { getFactoryAddress } from '../commons/addresses'

function isCompleteMint(mintId: string): boolean {
  const mintEvent = MintEvent.load(mintId)
  return mintEvent != null && mintEvent.sender !== null // sufficient checks
}

export function handleTransfer(event: Transfer): void {
  // ignore initial transfers for first adds
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.value.equals(BigInt.fromI32(1000))) {
    //log
    log.warning('Initial transfer', [])
    return
  }

  let factory = HoneyswapFactory.load(getFactoryAddress())
  if (!factory) {
    //log
    log.warning('Factory not found', [])
    return
  }
  let transactionHash = event.transaction.hash.toHexString()

  // user stats
  let from = event.params.from
  createUser(from)
  let to = event.params.to
  createUser(to)

  // get pair and load contract
  let pair = Pair.load(event.address.toHexString())
  if (!pair) {
    // log
    log.warning('Pair not found', [])
    return
  }
  let pairContract = PairContract.bind(event.address)

  // liquidity token amount being transfered
  let value = convertTokenToDecimal(event.params.value, BI_18)

  // get or create transaction
  let transaction = Transaction.load(transactionHash)
  if (transaction === null) {
    transaction = new Transaction(transactionHash)
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.burns = []
    transaction.swaps = []
  }

  // mints
  let mints = transaction.mints
  if (from.toHexString() == ADDRESS_ZERO) {
    // update total supply
    pair.totalSupply = pair.totalSupply.plus(value)
    pair.save()

    // create new mint if no mints so far or if last one is done already
    if (mints.length === 0 || isCompleteMint(mints[mints.length - 1])) {
      let mint = new MintEvent(
        event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(mints.length).toString())
      )
      mint.transaction = transaction.id
      mint.pair = pair.id
      mint.to = to
      mint.liquidity = value
      mint.timestamp = transaction.timestamp
      mint.transaction = transaction.id
      mint.save()

      // update mints in transaction
      transaction.mints = mints.concat([mint.id])

      // save entities
      transaction.save()
      factory.save()
    }
  }

  // case where direct send first on ETH withdrawls
  if (event.params.to.toHexString() == pair.id) {
    let burns = transaction.burns
    let burn = new BurnEvent(
      event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(burns.length).toString())
    )
    burn.transaction = transaction.id
    burn.pair = pair.id
    burn.liquidity = value
    burn.timestamp = transaction.timestamp
    burn.to = event.params.to
    burn.sender = event.params.from
    burn.needsComplete = true
    burn.transaction = transaction.id
    burn.save()

    // TODO: Consider using .concat() for handling array updates to protect
    // against unintended side effects for other code paths.
    burns.push(burn.id)
    transaction.burns = burns
    transaction.save()
  }

  // burn
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.from.toHexString() == pair.id) {
    pair.totalSupply = pair.totalSupply.minus(value)
    pair.save()

    // this is a new instance of a logical burn
    let burns = transaction.burns
    let burn: BurnEvent
    if (burns.length > 0) {
      let currentBurn = BurnEvent.load(burns[burns.length - 1])
      if (currentBurn && currentBurn.needsComplete) {
        burn = currentBurn as BurnEvent
      } else {
        burn = new BurnEvent(
          event.transaction.hash
            .toHexString()
            .concat('-')
            .concat(BigInt.fromI32(burns.length).toString())
        )
        burn.transaction = transaction.id
        burn.needsComplete = false
        burn.pair = pair.id
        burn.liquidity = value
        burn.transaction = transaction.id
        burn.timestamp = transaction.timestamp
      }
    } else {
      burn = new BurnEvent(
        event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(burns.length).toString())
      )
      burn.transaction = transaction.id
      burn.needsComplete = false
      burn.pair = pair.id
      burn.liquidity = value
      burn.transaction = transaction.id
      burn.timestamp = transaction.timestamp
    }

    // if this logical burn included a fee mint, account for this
    if (mints.length !== 0 && !isCompleteMint(mints[mints.length - 1])) {
      let mint = MintEvent.load(mints[mints.length - 1])
      if (mint) {
        burn.feeTo = mint.to
        burn.feeLiquidity = mint.liquidity
      }
      // remove the logical mint
      store.remove('Mint', mints[mints.length - 1])
      // update the transaction

      // TODO: Consider using .slice().pop() to protect against unintended
      // side effects for other code paths.
      mints.pop()
      transaction.mints = mints
      transaction.save()
    }
    burn.save()
    // if accessing last one, replace it
    if (burn.needsComplete) {
      // TODO: Consider using .slice(0, -1).concat() to protect against
      // unintended side effects for other code paths.
      burns[burns.length - 1] = burn.id
    }
    // else add new one
    else {
      // TODO: Consider using .concat() for handling array updates to protect
      // against unintended side effects for other code paths.
      burns.push(burn.id)
    }
    transaction.burns = burns
    transaction.save()
  }

  if (from.toHexString() != ADDRESS_ZERO && from.toHexString() != pair.id) {
    let fromUserLiquidityPosition = createLiquidityPosition(event.address, from)
    fromUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(from), BI_18)
    fromUserLiquidityPosition.save()
    createLiquiditySnapshot(fromUserLiquidityPosition, event)
  }

  if (event.params.to.toHexString() != ADDRESS_ZERO && to.toHexString() != pair.id) {
    let toUserLiquidityPosition = createLiquidityPosition(event.address, to)
    toUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(to), BI_18)
    toUserLiquidityPosition.save()
    createLiquiditySnapshot(toUserLiquidityPosition, event)
  }

  transaction.save()
}

export function handleSync(event: Sync): void {
  let pair = Pair.load(event.address.toHex())
  if (!pair) {
    log.warning('Pair does not exist: {}', [event.address.toHex()])
    return
  }
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  let honeyswap = HoneyswapFactory.load(getFactoryAddress())

  if (!honeyswap || !token0 || !token1) {
    // log
    log.warning('Honeyswap or token does not exist: {}', [event.address.toHex()])
    return
  }
  // reset factory liquidity by subtracting onluy tarcked liquidity
  honeyswap.totalLiquidityNativeCurrency = honeyswap.totalLiquidityNativeCurrency.minus(
    pair.trackedReserveNativeCurrency as BigDecimal
  )

  // reset token total liquidity amounts
  token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1)

  pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)

  if (pair.reserve1.notEqual(ZERO_BD)) pair.token0Price = pair.reserve0.div(pair.reserve1)
  else pair.token0Price = ZERO_BD
  if (pair.reserve0.notEqual(ZERO_BD)) pair.token1Price = pair.reserve1.div(pair.reserve0)
  else pair.token1Price = ZERO_BD

  pair.save()

  // update native currency price now that reserves could have changed
  let bundle = Bundle.load('1')
  if (!bundle) {
    log.warning('Bundle does not exist: {}', ['1'])
    return
  }
  bundle.nativeCurrencyPrice = getNativeCurrencyPriceInUSD()
  bundle.save()

  token0.derivedNativeCurrency = findNativeCurrencyPerToken(token0 as Token)
  token1.derivedNativeCurrency = findNativeCurrencyPerToken(token1 as Token)
  token0.save()
  token1.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityNativeCurrency: BigDecimal
  if (bundle.nativeCurrencyPrice.notEqual(ZERO_BD)) {
    trackedLiquidityNativeCurrency = getTrackedLiquidityUSD(
      pair.reserve0,
      token0 as Token,
      pair.reserve1,
      token1 as Token
    ).div(bundle.nativeCurrencyPrice)
  } else {
    trackedLiquidityNativeCurrency = ZERO_BD
  }

  // use derived amounts within pair
  pair.trackedReserveNativeCurrency = trackedLiquidityNativeCurrency
  pair.reserveNativeCurrency = pair.reserve0
    .times(token0.derivedNativeCurrency as BigDecimal)
    .plus(pair.reserve1.times(token1.derivedNativeCurrency as BigDecimal))
  pair.reserveUSD = pair.reserveNativeCurrency.times(bundle.nativeCurrencyPrice)

  // use tracked amounts globally
  honeyswap.totalLiquidityNativeCurrency = honeyswap.totalLiquidityNativeCurrency.plus(trackedLiquidityNativeCurrency)
  honeyswap.totalLiquidityUSD = honeyswap.totalLiquidityNativeCurrency.times(bundle.nativeCurrencyPrice)

  // now correctly set liquidity amounts for each token
  token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1)

  // save entities
  pair.save()
  honeyswap.save()
  token0.save()
  token1.save()
}

export function handleMint(event: Mint): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (!transaction) {
    log.warning('Transaction does not exist: {}', [event.transaction.hash.toHexString()])
    return
  }
  let mints = transaction.mints
  let mint = MintEvent.load(mints[mints.length - 1])

  let pair = Pair.load(event.address.toHex())
  let honeyswap = HoneyswapFactory.load(getFactoryAddress())

  if (!pair || !honeyswap || !mint) {
    log.warning('Pair or Honeyswap or Mint does not exist: {}', [event.address.toHex()])
    return
  }

  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)

  if (!token0 || !token1) {
    log.warning('Token does not exist: {}', [event.address.toHex()])
    return
  }
  // update exchange info (except balances, sync will cover that)
  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // get new amounts of USD and native currency for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = BigDecimal.zero()

  if (bundle && token1.derivedNativeCurrency && token0.derivedNativeCurrency) {
    amountTotalUSD = token1
      .derivedNativeCurrency!.times(token1Amount)
      .plus(token0.derivedNativeCurrency!.times(token0Amount))
      .times(bundle.nativeCurrencyPrice)
  }

  // update txn counts
  pair.txCount = pair.txCount.plus(ONE_BI)
  honeyswap.txCount = honeyswap.txCount.plus(ONE_BI)

  // save entities
  token0.save()
  token1.save()
  pair.save()
  honeyswap.save()

  mint.sender = event.params.sender
  mint.amount0 = token0Amount as BigDecimal
  mint.amount1 = token1Amount as BigDecimal
  mint.logIndex = event.logIndex
  mint.amountUSD = amountTotalUSD as BigDecimal
  mint.save()

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, Address.fromBytes(mint.to))
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateHoneyswapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

export function handleBurn(event: Burn): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())

  // safety check
  if (transaction === null) {
    // log
    log.warning('Transaction does not exist: {}', [event.transaction.hash.toHexString()])
    return
  }

  let burns = transaction.burns
  let burn = BurnEvent.load(burns[burns.length - 1])

  let pair = Pair.load(event.address.toHex())
  let honeyswap = HoneyswapFactory.load(getFactoryAddress())

  if (!pair || !honeyswap || !burn) {
    log.warning('Pair or Honeyswap or Burn does not exist: {}', [event.address.toHex()])
    return
  }

  //update token info
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)

  if (!token0 || !token1) {
    log.warning('Token does not exist: {}', [event.address.toHex()])
    return
  }

  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // get new amounts of USD and native currency for tracking

  let bundle = Bundle.load('1')
  let amountTotalUSD = BigDecimal.zero()

  if (bundle && token1.derivedNativeCurrency && token0.derivedNativeCurrency) {
    // non-null assertion here its necessary, if/ternary checks above are not sufficient for the compiler
    amountTotalUSD = token1
      .derivedNativeCurrency!.times(token1Amount)
      .plus(token0.derivedNativeCurrency!.times(token0Amount))
      .times(bundle.nativeCurrencyPrice)
  }
  // update txn counts
  honeyswap.txCount = honeyswap.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // update global counter and save
  token0.save()
  token1.save()
  pair.save()
  honeyswap.save()

  // update burn
  // burn.sender = event.params.sender
  burn.amount0 = token0Amount as BigDecimal
  burn.amount1 = token1Amount as BigDecimal
  // burn.to = event.params.to
  burn.logIndex = event.logIndex
  burn.amountUSD = amountTotalUSD as BigDecimal
  burn.save()

  // update the LP position
  // non-null assertion here its necessary, if/ternary checks above are not sufficient for the compiler
  let liquidityPosition = createLiquidityPosition(
    event.address,
    burn.sender ? Address.fromBytes(burn.sender!) : Address.zero()
  )
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateHoneyswapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString())
  if (!pair) {
    // log
    log.warning('Pair does not exist: {}', [event.address.toHexString()])
    return
  }
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)

  if (!token1 || !token0) {
    // log
    log.warning('Token does not exist: {}', [event.address.toHexString()])
    return
  }
  let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals)
  let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals)
  let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals)
  let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals)

  // totals for volume updates
  let amount0Total = amount0Out.plus(amount0In)
  let amount1Total = amount1Out.plus(amount1In)

  // native currency/USD prices
  let bundle = Bundle.load('1')

  if (!bundle) {
    log.warning('Bundle does not exist: {}', ['1'])
    return
  }
  let derivedAmountNativeCurrency: BigDecimal = BigDecimal.zero()
  let derivedAmountUSD: BigDecimal = BigDecimal.zero()

  if (token1.derivedNativeCurrency && token0.derivedNativeCurrency) {
    // get total amounts of derived USD and native currency for tracking
    derivedAmountNativeCurrency = token1
      .derivedNativeCurrency!.times(amount1Total)
      .plus(token0.derivedNativeCurrency!.times(amount0Total))
      .div(BigDecimal.fromString('2'))
    derivedAmountUSD = derivedAmountNativeCurrency.times(bundle.nativeCurrencyPrice)
  }

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(amount0Total, token0 as Token, amount1Total, token1 as Token, pair as Pair)

  let trackedAmountNativeCurrency: BigDecimal
  if (bundle.nativeCurrencyPrice.equals(ZERO_BD)) {
    trackedAmountNativeCurrency = ZERO_BD
  } else {
    trackedAmountNativeCurrency = trackedAmountUSD.div(bundle.nativeCurrencyPrice)
  }

  // update token0 global volume and token liquidity stats
  token0.tradeVolume = token0.tradeVolume.plus(amount0In.plus(amount0Out))
  token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(trackedAmountUSD)
  token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(derivedAmountUSD)

  // update token1 global volume and token liquidity stats
  token1.tradeVolume = token1.tradeVolume.plus(amount1In.plus(amount1Out))
  token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(trackedAmountUSD)
  token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(derivedAmountUSD)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD)
  pair.volumeToken0 = pair.volumeToken0.plus(amount0Total)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1Total)
  pair.untrackedVolumeUSD = pair.untrackedVolumeUSD.plus(derivedAmountUSD)
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.save()

  // update global values, only used tracked amounts for volume
  let honeyswap = HoneyswapFactory.load(getFactoryAddress())
  if (honeyswap) {
    honeyswap.totalVolumeUSD = honeyswap.totalVolumeUSD.plus(trackedAmountUSD)
    honeyswap.totalVolumeNativeCurrency = honeyswap.totalVolumeNativeCurrency.plus(trackedAmountNativeCurrency)
    honeyswap.untrackedVolumeUSD = honeyswap.untrackedVolumeUSD.plus(derivedAmountUSD)
    honeyswap.txCount = honeyswap.txCount.plus(ONE_BI)
  }

  // save entities
  pair.save()
  token0.save()
  token1.save()
  if (honeyswap) {
    honeyswap.save()
  }
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.swaps = []
    transaction.burns = []
  }
  let swaps = transaction.swaps
  let swap = new SwapEvent(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(swaps.length).toString())
  )

  // update swap event
  swap.transaction = transaction.id
  swap.pair = pair.id
  swap.timestamp = transaction.timestamp
  swap.transaction = transaction.id
  swap.sender = event.params.sender
  swap.amount0In = amount0In
  swap.amount1In = amount1In
  swap.amount0Out = amount0Out
  swap.amount1Out = amount1Out
  swap.to = event.params.to
  swap.from = event.transaction.from
  swap.logIndex = event.logIndex
  // use the tracked amount if we have it
  swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
  swap.save()

  // update the transaction

  // TODO: Consider using .concat() for handling array updates to protect
  // against unintended side effects for other code paths.
  swaps.push(swap.id)
  transaction.swaps = swaps
  transaction.save()

  // update day entities
  let pairDayData = updatePairDayData(event)
  let pairHourData = updatePairHourData(event)
  let swaprDayData = updateHoneyswapDayData(event)
  let token0DayData = updateTokenDayData(token0 as Token, event)
  let token1DayData = updateTokenDayData(token1 as Token, event)

  // swap specific updating
  swaprDayData.dailyVolumeUSD = swaprDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  swaprDayData.dailyVolumeNativeCurrency = swaprDayData.dailyVolumeNativeCurrency.plus(trackedAmountNativeCurrency)
  swaprDayData.dailyVolumeUntracked = swaprDayData.dailyVolumeUntracked.plus(derivedAmountUSD)
  swaprDayData.save()

  // swap specific updating for pair
  pairDayData.dailyVolumeToken0 = pairDayData.dailyVolumeToken0.plus(amount0Total)
  pairDayData.dailyVolumeToken1 = pairDayData.dailyVolumeToken1.plus(amount1Total)
  pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  pairDayData.save()

  // update hourly pair data
  pairHourData.hourlyVolumeToken0 = pairHourData.hourlyVolumeToken0.plus(amount0Total)
  pairHourData.hourlyVolumeToken1 = pairHourData.hourlyVolumeToken1.plus(amount1Total)
  pairHourData.hourlyVolumeUSD = pairHourData.hourlyVolumeUSD.plus(trackedAmountUSD)
  pairHourData.save()

  // swap specific updating for token0
  token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Total)
  token0DayData.dailyVolumeNativeCurrency = token0DayData.dailyVolumeNativeCurrency.plus(
    amount0Total.times(token1.derivedNativeCurrency as BigDecimal)
  )
  token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD.plus(
    amount0Total.times(token0.derivedNativeCurrency as BigDecimal).times(bundle.nativeCurrencyPrice)
  )
  token0DayData.save()

  // swap specific updating
  token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Total)
  token1DayData.dailyVolumeNativeCurrency = token1DayData.dailyVolumeNativeCurrency.plus(
    amount1Total.times(token1.derivedNativeCurrency as BigDecimal)
  )
  token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD.plus(
    amount1Total.times(token1.derivedNativeCurrency as BigDecimal).times(bundle.nativeCurrencyPrice)
  )
  token1DayData.save()
}
