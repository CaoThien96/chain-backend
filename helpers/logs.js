const _ = require('lodash')

exports.filterLogs = (logs, request) => {
    const { address, topics, from, to } = request
    logs = logs.filter(log => from <= log.blockNumber)
    if (to) {
        logs = logs.filter(log => log.blockNumber <= to)
    }
    if (address) {
        if (Array.isArray(address)) {
            logs = logs.filter(log => address.includes(log.address))
        } else {
            logs = logs.filter(log => address === log.address)
        }
    }
    if (topics) {
        logs = logs.filter(log => !topics.some((topic, i) => topic && log.topics[i] !== topic))
    }
    return logs
}

exports.mergeTopics = (topics) => {
    return topics
        .map(ts => ts.map(t => _.isArray(t) ? t : [t])) // wrap all single topic to array
        .reduce((topics, ts, it) => {
            ts.forEach((t, i) => {
                t.forEach(ti => {
                    if (!topics[i]) {
                        topics[i] = []
                    }
                    if (!topics[i].includes(ti)) {
                        topics[i].push(ti)
                    }
                })
            })
            return topics
        })
}

exports.mergeAddress = (requests) => {
    if (requests.some(r => !r.address)) {
        return undefined
    }
    return _.flatten(requests.filter(r => !!r.address).map(r => r.address))
}

exports.mergeRequests = ({requests, fromBlock, toBlock}, getLogsFn) => {
    requests = requests
        .filter(r => !toBlock || r.from <= toBlock)
        .filter(r => !r.to || r.to >= fromBlock)
    if (requests.length == 0) {
        // console.log(`no request in range ${fromBlock} +${toBlock-fromBlock}`)
        return []
    }
    const address = exports.mergeAddress(requests)
    const topics = exports.mergeTopics(requests.map(r => r.topics))
    return {address, fromBlock, toBlock, topics}
}
