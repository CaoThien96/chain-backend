const Bluebird = require('bluebird')
const _ = require('lodash')
const { mergeRequests, partitionRequests } = require("../ethers-log-filter")

// Input
//  * config {ChainlogProcessorConfig}
//  * consumers {Array<Consumer>}
//  * mongoose {ChainBackendMongoose}
function chainlogHeadProcessor({configs, consumers, mongoose}) {
    // rollback the lastHead
    // ConfigModel.updateOne(
    //     { key: 'lastHead' },
    //     { value: 8000000 },
    //     { upsert: true },
    // ).then(console.log).catch(console.error)

    let ConfigModel = mongoose.model('Config')

    const process = async (head) => {
        const _splitChunks = (from, to, count) => {
            // console.log('slpitChunks', {from, to, count})
            const size = Math.round((to - from) / count)
            const blocks = _.range(count).map(i => {
                const fromBlock = from + (size * i)
                const toBlock = fromBlock + size - 1
                return {
                    fromBlock,
                    toBlock,
                }
            });
            return blocks;
        }

        let lastHead = await ConfigModel.findOne({
            key: 'lastHead'
        }).lean().then(m => m && m.value)

        const mergeRange = configs.merge.getSize()
    
        if (!lastHead) {    // init the first sync
            lastHead = head - mergeRange
            await ConfigModel.updateOne(
                { key: 'lastHead' },
                { value: lastHead },
                { upsert: true },
            )
        }

        if (head <= lastHead) {
            return  // nothing to do
        }

        if (lastHead + mergeRange < head) {
            const config = configs.partition

            const concurrency = config.getConcurrency()
            const maxRange = concurrency * config.getSize()
            let requests = await Bluebird.map(consumers, c => c.getRequests({maxRange, lastHead, head}))
                .then(_.flatten)
                .filter(r => r.from > lastHead)
        
            if (!requests.length) {
                return false
            }
    
            const fromBlock = Math.min(lastHead+1, ...requests.map(r => r.from))
            if (fromBlock + maxRange <= head) {
                var toBlock = fromBlock + maxRange - 1
            }
    
            console.log('++++ HEAD', { lastHead, head })
            console.log('         ', { fromBlock, toBlock })
            console.log(requests.map(({key, from, to}) => `\t${key}:\t${from}${to ? ` +${to-from+1}` : ''}`).join('\n'))
    
            // TODO: check block range for partitioning condition here
    
            // partition similar requests base on the same combination of address and each topic
            const parts = partitionRequests(requests)

            const logs = await Bluebird.map(parts, requests => {
                const chunks = _splitChunks(fromBlock, toBlock, concurrency);
                return Bluebird.map(chunks, ({ fromBlock, toBlock }) => {
                    const merged = mergeRequests({requests, fromBlock, toBlock})
                    if (merged) {
                        return config.getLogs(merged, concurrency * parts.length)
                    }
                }).then(_.flatten).filter(l => l);
            })
    
            await Bluebird.map(parts, (requests, i) =>
                Bluebird.map(requests, request =>
                    request.processLogs({ request, logs: logs[i], fromBlock, toBlock, lastHead, head })
                )
            )

            await ConfigModel.updateOne(
                { key: 'lastHead' },
                { value: toBlock || head },
                { upsert: true },
            )
    
            return toBlock && toBlock < head
        }

        const config = configs.merge
        const maxRange = config.getSize()

        const requests = await Bluebird.map(consumers, c => c.getRequests({maxRange, lastHead, head}))
            .then(_.flatten)
            .filter(r => r.from > lastHead)
    
        if (!requests.length) {
            return false
        }

        console.log('++++ HEAD', { lastHead, head })
        console.log(requests.map(({key, from, to}) => `\t${key}:\t${from}${to ? ` +${to-from+1}` : ''}`).join('\n'))
    
        const fromBlock = Math.min(lastHead+1, ...requests.map(r => r.from))
        if (fromBlock + maxRange <= head) {
            var toBlock = fromBlock + maxRange - 1
        }

        const merged = mergeRequests({requests, fromBlock, toBlock})
        if (merged) {
            const logs = await config.getLogs(merged)
            if (!logs) {
                return false // failed
            }
    
            if (!toBlock) {
                toBlock = Math.max(head, ...logs.map(l => l.blockNumber))
            }

            console.log('      HEAD:', { fromBlock, range: toBlock-fromBlock, behind: head-toBlock })
            await Bluebird.map(requests, request => request.processLogs({ request, logs, fromBlock, toBlock, lastHead, head }))
        }

        await ConfigModel.updateOne(
            { key: 'lastHead' },
            { value: toBlock || head },
            { upsert: true },
        )
    
        return toBlock && toBlock < head
    }

    return {
        process,
    }
}

module.exports = chainlogHeadProcessor
