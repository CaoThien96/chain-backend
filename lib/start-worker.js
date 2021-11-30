'use strict'

const mongoose = require('./mongoose')
const {standardizeStartConfiguration} = require('./validator')
const chainlogHeadProcessor = require('./service/chainlog-head-processor')
const chainlogPastProcessor = require('./service/chainlog-past-processor')
const { delay, rpcKnownError } = require('./util')

// Description
//  * Start a worker that retrieve and store data from Binance Smart Chain
//    network.
//
// Input
//  * config {Object}
//  * config.consumerConstructors {Array<ConsumerConstructor>}
//  * config.mongoose {mongoose.Mongoose} There are reserved model's names and
//    must not use by outside of this function: 'Config', 'LogsState'.
//  * config.processorConfigs {Object}
//  * config.delayedBlocks {number=0} The worker processes block at
//    "latest - delayedBlocks" instead of latest block. This configuration
//    can be use to avoid incorrect log records which is causes by
//    reorganisation behaviors. On BSC network, it can be set by 6.
//
// Errors
//  * ChainBackendError
async function startWorker(config) {
    let validConfig = standardizeStartConfiguration(config)

    await _startWorker(validConfig)
}

// Input
//  * config {WorkerConfiguration}
async function _startWorker(config) {
    mongoose.applySchemaList(config.mongoose)

    const consumers = _createConsumers(
        config.consumerConstructors,
        config.mongoose
    )
    const headProcessor = chainlogHeadProcessor({
        consumers: consumers,
        configs: config.processorConfigs,
        mongoose: config.mongoose
    })
    const pastProcessor = chainlogPastProcessor({
        consumers: consumers,
        configs: config.processorConfigs,
        indexerEndpoint: config.indexerEndpoint,
        mongoose: config.mongoose
    })
    const provider = config.processorConfigs.merge.getProvider()
    const context = {
        latency: config.latency,
        provider,
        headProcessor: headProcessor,
        pastProcessor: pastProcessor,
        head: await provider.getBlockNumber(),
    }

    provider.on('block', blockNumber => {
        context.head = Math.max(0, blockNumber - config.delayedBlocks)
    })

    _startProcessingLoop(context)
}

function _createConsumers(constructors, mongoose) {
    return Object.entries(constructors).map(([key, constructor]) => {
        return constructor({key, mongoose})
    })
}

async function _startProcessingLoop(context) {
    let nextPastProcess = Date.now()

    while (true) {
        // HEAD
        if ((context.lastHead ?? 0) < context.head) {
            const head = context.head
            try {
                await context.headProcessor.process(head)
                context.lastHead = head
            }
            catch (error) {
                if (!rpcKnownError(error)) {
                    console.error('unexpected error: ', error)
                }
                console.log('[WARNING] head processing loop:', error.code)
            }
        }

        // PAST
        while (true) {
            const latency = context.head - context.lastHead
            if ((context.latency ?? 0) < latency) {
                console.log('latency reached', latency)
                break
            }

            if (Date.now() < nextPastProcess) {
                await delay(Math.min(1000, nextPastProcess-Date.now()))
                continue
            }

            try {
                const nextDelay = await context.pastProcessor.process()
                if (!!nextDelay) {
                    console.log(`next past processing in ${nextDelay/1000}s`)
                    nextPastProcess = Date.now() + nextDelay
                    break
                }
            }
            catch (error) {
                if (!rpcKnownError(error)) {
                    console.error('unexpected error: ', error)
                }
                console.log('[WARNING] past processing loop:', error.code)
                nextPastProcess = Date.now() + 1000
            }
        }
    }
}

module.exports = startWorker
