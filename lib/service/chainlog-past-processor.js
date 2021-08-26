const Bluebird = require('bluebird')
const _ = require('lodash')
const { mergeRequests, partitionRequests, filterLogs } = require("../ethers-log-filter")
const { splitChunks } = require("../util")

// Input
//  * config {ChainlogProcessorConfig}
//  * consumers {Array<Consumer>}
//  * mongoose {ChainBackendMongoose}
const chainlogPastProcessor = ({configs, consumers, mongoose}) => {
    const config = configs.partition    // past processor always use partition config
    const ConfigModel = mongoose.model('Config')

    const process = async () => {
        const lastHead = await ConfigModel.findOne({
            key: 'lastHead'
        }).lean().then(m => m && m.value);
    
        const concurrency = config.getConcurrency()
        const maxRange = concurrency * config.getSize()
        const consumerRequests = await Bluebird.map(consumers,
            c => c.getRequests({maxRange, lastHead})
            .then(rr => _.filter(rr, r => r.from <= lastHead))
        )
        let requests = consumerRequests.flat()
    
        if (!requests.length) {
            return 3000 // no more requests, wait for 3s
        }

        const fromBlock = Math.min(...requests.map(r => r.from))
        const toBlock = Math.min(fromBlock + maxRange - 1, lastHead)
        requests = requests.filter(r => r.from <= toBlock && (!r.to || r.to >= fromBlock))

        // partition similar requests base on the same combination of address and each topic
        const parts = partitionRequests(requests)

        const logs = await Bluebird.map(parts, requests => {
            const chunks = splitChunks(fromBlock, toBlock, concurrency);
            return Bluebird.map(chunks, ({ fromBlock, toBlock }) => {
                const merged = mergeRequests({requests, fromBlock, toBlock})
                if (merged) {
                    return config.getLogs(merged, concurrency * parts.length)
                }
            }).then(_.flatten).filter(l => l);
        }).then(_.flatten)

        console.log('---- PAST', { fromBlock, range: toBlock-fromBlock+1, behind: lastHead-toBlock, logs: logs.length })

        await Bluebird.map(consumers, (consumer, i) => {
            const requests = consumerRequests[i]
            if (!requests || !requests.length) {
                return
            }

            const consumerLogs = requests
                .map(request => filterLogs(logs, request))
                .flat()
                .sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex)

            const { key, from, to } = requests[0]
            console.log(`\t${from} +${(to||toBlock)-from+1} :${consumerLogs.length}\t${key}`)

            return consumer.processLogs({ logs: consumerLogs, fromBlock, toBlock, lastHead })
        })
    }

    return {
        process,
    }
}

module.exports = chainlogPastProcessor
