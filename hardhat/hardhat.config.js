/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.7.3",
  networks:{
    hardhat:{
      forking:{
        url: "https://xdai-archive.blockscout.com",
        blockNumber: 11813490
      }
    }
  }
};
