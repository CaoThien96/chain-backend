const Bluebird = require('bluebird')
const _ = require('lodash')
const { mergeRequests, partitionRequests, filterLogs } = require("../ethers-log-filter")

// Input
//  * config {ChainlogProcessorConfig}
//  * consumers {Array<Consumer>}
//  * mongoose {ChainBackendMongoose}
function chainlogHeadProcessor({configs, consumers, mongoose}) {
    // rollback the lastHead
    // mongoose.model('Config').updateOne(
    //     { key: 'lastHead' },
    //     { value: 8000000 },
    //     { upsert: true },
    // ).then(console.log).catch(console.error)

    let ConfigModel = mongoose.model('Config')

    const process = async (head) => {
        let lastHead = await ConfigModel.findOne({
            key: 'lastHead'
        }).lean().then(m => m && m.value)

        const mergeRange = configs.merge.getSize()

        if (lastHead === undefined) {    // init the first sync
            lastHead = Math.max(0, head - mergeRange)
            await ConfigModel.updateOne(
                { key: 'lastHead' },
                { value: lastHead },
                { upsert: true },
            )
        }

        if (head <= lastHead) {
            return  // nothing to do
        }

        const isMerged = head <= lastHead + mergeRange
        const config = isMerged ? configs.merge : configs.partition
        const maxRange = config.getSize()

        const consumerRequests = await Bluebird.map(consumers, consumer => {
            // Possible issue:
            //  * Consumers returns a request [a, b], where "a <= lastHead"
            //    and "b > lastHead"
            //  * Then the request is reject because "a <= lastHead".
            //  * Logs in range [lastHead, b] is missing without acknowledge
            //    from consumers.
            consumer
                .getRequests({ maxRange, lastHead, head })
                .then(rr => _.filter(rr, r => r.from > lastHead))
        })
        let requests = consumerRequests
            .flat()
            .filter(request => (request !== undefined))

        if (!requests.length) {
            await ConfigModel.updateOne(
                { key: 'lastHead' },
                { value: head },
                { upsert: true },
            )
            return false
        }

        let fromBlock = Math.min(lastHead+1, ...requests.map(r => r.from))
        let toBlock = Math.min(fromBlock + maxRange,  head)
        let logs = []

        if (isMerged) {
            const merged = mergeRequests({requests, fromBlock, toBlock})
            if (merged) {
                logs = await config.getLogs(merged)
            }
        } else {
            // partition similar requests base on the same combination of address and each topic
            const parts = partitionRequests(requests)

            const logss = await Bluebird.map(parts, requests => {
                const merged = mergeRequests({requests, fromBlock, toBlock})
                return config.getLogs(merged, parts.length)
            })
            logs = _.flatten(logss)
        }

        if (logs && logs.length) {
            // truncate all log higher than toBlock to prevent missing head
            const lenBefore = logs.length
            logs = logs.filter(log => log.blockNumber <= toBlock)
            if (logs.length != lenBefore) {
                console.warn('TRUNCATED', lenBefore - logs.length)
            }
        }

        console.log('++++ HEAD ' + (isMerged ? '(MERGE)' : '(PARTITION)'),
            { fromBlock, range: toBlock-fromBlock+1, behind: head-toBlock, logs: logs.length }
        )

        // group and sort by order
        const groups = _.chain(consumers)
            .groupBy(o => o.order ?? 0)
            .map((consumers, order) => ({order, consumers}))
            .sortBy('order')
            .value()
            .map(o => o.consumers)

        const requestsByKey = _.zipObject(consumers.map(c => c.key), consumerRequests)

        for (const consumers of groups) {
            await Bluebird.map(consumers, consumer => {
                const requests = requestsByKey[consumer.key]
                if (!requests || !requests.length) {
                    return
                }

                // Possible issue:
                //  * Sort by tuple (blockNumber, transactionIndex) does not
                //    guarantee ordered logs. Sort by (blockNumber, logIndex)
                //    does.
                const consumerLogs = requests
                    .map(request => filterLogs(logs, request))
                    .flat()
                    .sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex)

                console.log(`\t${fromBlock} +${toBlock-fromBlock+1} :${consumerLogs.length}\t${consumer.key}`)

                return consumer.processLogs({ logs: consumerLogs, fromBlock, toBlock, lastHead, head })
            })
        }

        await ConfigModel.updateOne(
            { key: 'lastHead' },
            { value: toBlock },
            { upsert: true },
        )

        return toBlock && toBlock < head
    }

    return {
        process,
    }
}

module.exports = chainlogHeadProcessor
