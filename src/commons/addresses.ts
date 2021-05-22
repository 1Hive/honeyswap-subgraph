/* eslint-disable prefer-const */
import { dataSource, log } from '@graphprotocol/graph-ts'

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export function getFactoryAddress(): string {
  let network = dataSource.network() as string
  // not using a switch-case because using strings is not yet supported (only u32)
  if (network == 'mainnet') return '0xd34971bab6e5e356fd250715f5de0492bb070452'
  if (network == 'xdai') return '0xa818b4f111ccac7aa31d0bcc0806d64f2e0737d7'
  if (network == 'matic') return '0x03daa61d8007443a6584e3d8f85105096543c19c'
  log.warning('no factory address for unsupported network {}', [network])
  return ADDRESS_ZERO
}

export function getNativeCurrencyWrapperAddress(): string {
  let network = dataSource.network() as string
  // not using a switch-case because using strings is not yet supported (only u32)
  if (network == 'mainnet') return '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  if (network == 'xdai') return '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d'
  if (network == 'matic') return '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'
  log.warning('no native currency wrapper address for unsupported network {}', [network])
  return ADDRESS_ZERO
}

export function getLiquidityTrackingTokenAddresses(): string[] {
  let network = dataSource.network() as string
  // not using a switch-case because using strings is not yet supported (only u32)
  if (network == 'mainnet') {
    return [
      '0xa1d65e8fb6e87b60feccbc582f7f97804b725521', // DXD
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
      '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
      '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643', // cDAI
      '0x39aa39c021dfbae8fac545936693ac917d5e7563', // cUSDC
      '0x0ae055097c6d159879521c384f1d2123d1f195e6', // STAKE
      '0xa117000000f279d81a1d3cc75430faa017fa5a2e', // ANT
      '0xd56dac73a4d6766464b38ec6d91eb45ce7457c44', // PAN
      '0x86fadb80d8d2cff3c3680819e4da99c10232ba0f', // EBASE
      '0x57ab1ec28d129707052df4df418d58a2d46d5f51', // sUSD
      '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
      '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP
      '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
      '0x960b236a07cf122663c4303350609a66a7b288c0', // ANTyar
      '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', // SNX
      '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', // YFI
      '0xdf5e0e81dff6faf3a7e52ba697820c5e32d806a8', // yCurv
      '0xd533a949740bb3306d119cc777fa900ba034cd52' // CRV
    ]
  }
  if (network == 'xdai') {
    return [
      '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', // WXDAI
      '0x71850b7E9Ee3f13Ab46d67167341E4bDc905Eef9', // HNY
      '0x3a97704a1b25f08aa230ae53b352e2e72ef52843', // AGVE
      '0xb90d6bec20993be5d72a5ab353343f7a0281f158', // DXD
      '0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1' // WETH
    ]
  }
  if (network == 'matic') {
    return [
      '0x4c28f48448720e9000907bc2611f73022fdce1fa', // WMATIC
      '0xb371248dd0f9e4061ccf8850e9223ca48aa7ca4b', // HNY
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
      '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
      '0xcB1e72786A6eb3b44C2a2429e317c8a2462CFeb1', // DAI
      '0x714550C2C1Ea08688607D86ed8EeF4f5E4F22323' // ETH
    ]
  }
  log.warning('no liquidity tracking token address for unsupported network {}', [network])
  return []
}

export function getUsdcNativeCurrencyWrapperPairAddress(): string {
  let network = dataSource.network() as string
  // not using a switch-case because using strings is not yet supported (only u32)
  if (network == 'mainnet') return '0x98f29f527c8e0ecc67a3c2d5567833bee01f2a12'
  if (network == 'xdai') return ADDRESS_ZERO
  if (network == 'matic') return '0x86b7249272fabb82ef36550ef898ea539225e7f0'
  log.warning('no usdc native currency wrapper pair address for unsupported network {}', [network])
  return ADDRESS_ZERO
}

export function getDaiNativeCurrencyWrapperPairAddress(): string {
  let network = dataSource.network() as string
  // not using a switch-case because using strings is not yet supported (only u32)
  if (network == 'mainnet') return '0x7515be43d16f871588adc135d58a9c30a71eb34f'
  if (network == 'xdai') return ADDRESS_ZERO
  if (network == 'matic') return '0xcba9d57e29ab4eeb9aa69cd82f93b64505055a3b'
  log.warning('no dai native currency wrapper pair address for unsupported network {}', [network])
  return ADDRESS_ZERO
}

export function getUsdtNativeCurrencyWrapperPair(): string {
  let network = dataSource.network() as string
  // not using a switch-case because using strings is not yet supported (only u32)
  if (network == 'mainnet') return '0x83dd8227c5ef121f2ae99c6f1df0aa9e914448ce'
  if (network == 'xdai') return ADDRESS_ZERO
  if (network == 'matic') return '0x218e468b15469228f35b0e7f88425cd45fb982bd'
  log.warning('no usdt native currency wrapper pair address for unsupported network {}', [network])
  return ADDRESS_ZERO
}
