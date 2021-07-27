const { ethers } = require('ethers')
const contractABI = require('../ABIs/SFarm.json').abi
const accumulator = require('./factory/ac')

module.exports = (key) => {
    // reset the state
    // require('../models/LogsStateModel').deleteOne({ key }).then(console.error).catch(console.error)

    const SFarm = new ethers.Contract(process.env.FARM, contractABI)
    const filter = SFarm.filters.AuthorizeWithdrawalFunc(null, null)

    return accumulator({
        key,
        filter,
        genesis: parseInt(process.env.FARM_GENESIS),

        applyLogs: (value, logs) => {
            value = {...value}

            // assume that the logs is sorted by blockNumber and transactionIndex
            logs.forEach(log => {
                const router = ethers.utils.getAddress('0x'+log.topics[1].slice(26))
                const func = log.topics[2].substr(2, 8) // without 0x
                const mask = parseInt(log.data, 16)
                const key = `${router}-${func}`
                if (mask) {
                    value[key] =  mask
                } else {
                    delete value[key]
                }
            })

            return value
        }
    })
}
