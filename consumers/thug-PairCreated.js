const { ethers } = require('ethers')
const contractABI = require('../ABIs/UniswapV2Factory.json').abi
const ac = require('./factory/ac')

module.exports = (key) => {
    // reset the state
    // require('../models/LogsStateModel').deleteOne({ key }).then(console.error).catch(console.error)

    const genesis = 2093701
    const pair = new ethers.Contract('0xaC653cE27E04C6ac565FD87F18128aD33ca03Ba2', contractABI)
    const filter = pair.filters.PairCreated(null, null)

    return ac({
        key,
        filter,
        genesis,

        applyLogs: (value, logs) => {
            if (!logs.length) {
                return value
            }
            value = {...value}
            logs.forEach(log => {
                const { topics, data } = log
                const token0 = ethers.utils.getAddress('0x' + topics[1].substr(26))
                const token1 = ethers.utils.getAddress('0x' + topics[1].substr(26))
                const pair = ethers.utils.getAddress('0x' + data.substr(26, 40))
                value[pair] = { token0, token1 }
            })
            return value
        }
    })
}
