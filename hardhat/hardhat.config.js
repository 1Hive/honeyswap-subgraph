/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: '0.7.3',
  networks: {
    hardhat: {
      forking: {
        url: 'https://gno.getblock.io/mainnet/?api_key=',
        blockNumber: 11813490
      }
    }
  }
}
