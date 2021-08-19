const { ethers } = require('ethers')
const { ZERO_HASH } = require('../../helpers/constants').hexes
const contractABI = require('../../ABIs/SFarm.json').abi
const accumulator = require('../../factory/ac')

// Input
//  * config.key {String}
//  * config.farm {String}
//  * config.farmGenesis {String}
module.exports = (config) => {
    // reset the state
    // require('../models/LogsStateModel').deleteOne({ key }).then(console.error).catch(console.error)

    const SFarm = new ethers.Contract(config.farm, contractABI)
    const filter = SFarm.filters.AuthorizeFarmer(null, null)

    return accumulator({
        key: config.key,
        filter: filter,
        genesis: parseInt(config.farmGenesis),

        applyLogs: (value, logs) => {
            value = {...value}

            // assume that the logs is sorted by blockNumber and transactionIndex
            logs.forEach(log => {
                const address = ethers.utils.getAddress('0x'+log.topics[1].slice(26))
                if (log.data != ZERO_HASH) {
                    value[address] = true
                } else {
                    delete value[address]
                }
            })

            return value
        }
    })
}
