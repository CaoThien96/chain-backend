const _ = require('lodash')
const { ZERO_ADDRESS } = require('../helpers/constants').hexes
const { TOKENS } = require('../helpers/constants').bsc
const Bluebird = require('bluebird')
const ConfigModel = require('../models/ConfigModel')
const UniswapV2Router01 = require('../ABIs/UniswapV2Router01.json').abi
const UniswapV2Pair = require('../ABIs/UniswapV2Pair.json').abi
const mongoose = require("mongoose");
mongoose.set("useFindAndModify", false);
const { ethers } = require('ethers')
const bn = ethers.BigNumber

var provider
function getProvider() {
    if (!provider) {
        const { JsonRpcProvider } = require('@ethersproject/providers')
        provider = new JsonRpcProvider({
            timeout: 3000,
            url: process.env.RPC,
        })
    }
    return provider
}

const MIDS = [
    TOKENS.BTCB,
    TOKENS.ETH,
    TOKENS.DOT,
    TOKENS.USDC,
    TOKENS.DAI,
]

const MULTI_MIDS = [ [[]], MIDS, [], [] ]
for (let i = 0; i < MIDS.length; ++i) {
    for (let j = 0; j < MIDS.length; ++j) {
        if (i != j) {
            MULTI_MIDS[2].push([MIDS[i], MIDS[j]])
            for (let k = 0; k < MIDS.length; ++k) {
                if (k != i && k != j) {
                    MULTI_MIDS[3].push([MIDS[i], MIDS[j], MIDS[k]])
                }
            }
        }
    }
}

const DEXES = [
    { swap: 'pancake' },                        // 0
    { swap: 'pancake', mid: TOKENS.WBNB },      // 1
    { swap: 'pancake', mid: TOKENS.CAKE },      // 2
    { swap: 'pancake', mid: TOKENS.BUSD },      // 3
    { swap: 'pancake', mid: TOKENS.USDT },      // 4
    { swap: 'bakery' },                         // 5
    { swap: 'bakery', mid: TOKENS.WBNB },       // 6
    { swap: 'bakery', mid: TOKENS.BUSD },       // 7
    { swap: 'pancake2' },                       // 8
    { swap: 'pancake2', mid: TOKENS.WBNB },     // 9
    { swap: 'pancake2', mid: TOKENS.CAKE },     // 10
    { swap: 'pancake2', mid: TOKENS.BUSD },     // 11
    { swap: 'pancake2', mid: TOKENS.USDT },     // 12
    { swap: 'jul' },                            // 13
    { swap: 'jul', mid: TOKENS.WBNB },          // 14
    { swap: 'ape' },                            // 15
    { swap: 'ape', mid: TOKENS.WBNB },          // 16
    { swap: 'ape', mid: TOKENS.BUSD },          // 17
]

const ROUTERS = {
    pancake: '0x05fF2B0DB69458A0750badebc4f9e13aDd608C7F',
    bakery: '0xCDe540d7eAFE93aC5fE6233Bee57E1270D3E330F',
    pancake2: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    jul: '0xbd67d157502A23309Db761c41965600c2Ec788b2',
    ape: '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7',
}

const sum = (chunks) => chunks.reduce((sum, a) => sum + a, 0)
const count = (chunks) => chunks.reduce((count, chunk) => count + chunk ? 1 : 0, 0)

function tokenName(address) {
    const mid = Object.entries(TOKENS).find(([, a]) => a == address)
    if (mid) {
        return mid[0]
    }
}

const CONTRACTS = {
    swapXView: new ethers.Contract('0x99Ab3d8DC4F2130F4E542506A0E9e87bA9ed7d7b', require('../ABIs/SwapXView.abi.json'), getProvider()),
    swapX: new ethers.Contract('0xAAa6866475564E9070d0330DFCC637D16dfccE17', require('../ABIs/SwapX.abi.json'), getProvider()),
    swapXProxy: new ethers.Contract('0x887907d19360b32744A56B931a022530567Fbcb3', require('../ABIs/SwapXProxy.abi.json'), getProvider()),
}
function getRouterContract(swap) {
    if (CONTRACTS[swap]) {
        return CONTRACTS[swap]
    }
    if (!ROUTERS[swap]) {
        console.warn(`WARN: no router address for ${swap}`)
        return
    }
    return CONTRACTS[swap] = new ethers.Contract(ROUTERS[swap], UniswapV2Router01, getProvider())
}

async function getAmountOutByReserves(swap, amountIn, reserveIn, reserveOut) {
    if (!amountIn || amountIn.isZero()) {
        return 0
    }
    const fee10000 = FEE10000[swap]
    const amountInWithFee = bn.from(10000).sub(fee10000).mul(amountIn)
    const numerator = amountInWithFee.mul(reserveOut)
    const denominator = bn.from(reserveIn).mul(10000).add(amountInWithFee)
    const amountOut = numerator.div(denominator)
    if (process.env.DEBUG) {
        const contract = getRouterContract(swap)
        if (contract) {
            const contractOut = await contract.callStatic.getAmountOut(amountIn, reserveIn, reserveOut)
            if (!amountOut.eq(contractOut)) {
                console.error('getAmountOut: WRONG calculation', {swap, fee10000, amountOut: amountOut.toString(), contractOut: contractOut.toString()})
            }
        }
    }
    return amountOut
}

const FEE10000 = { pancake2: 25, pancake: 20, bakery: 30, ape: 20, jul: 30 }

// async function getFee10000(swap) {
//     if (FEE10000[swap]) {
//         return FEE10000[swap]
//     }
//     const key = `router-fee-${swap}`
//     const savedValue = await ConfigModel.findOne({ key }).lean().then(m => m && m.value)
//     if (savedValue) {
//         return FEE10000[swap] = savedValue
//     }
//     const contract = getRouterContract(swap)
//     const ret = await contract.callStatic.getAmountOut(100000, '1'+'0'.repeat(32), '1'+'0'.repeat(32))
//     const value = Math.round(10000 - ret.toNumber() / 10)
//     await ConfigModel.updateOne(
//         { key },
//         { value },
//         { upsert: true },
//     )
//     return FEE10000[swap] = value
// }

// function bnDiv(a, b) {
//     while(true) {
//         try {
//             return a.toNumber() / b.toNumber()
//         } catch(err) {
//             a = a.div(2)
//             b = b.div(2)
//         }
//     }
// }

function predictGas(hops) {
    return 130000 + hopsGas(hops)
}

function hopsGas(hops) {
    return hops * 120000
}

async function findPath({ inputToken, outputToken, amountIn, trader, noms, gasPrice, gasToken }) {
    inputToken = ethers.utils.getAddress(inputToken)
    outputToken = ethers.utils.getAddress(outputToken)
    amountIn = bn.from(amountIn)
    trader = ethers.utils.getAddress(trader || ZERO_ADDRESS)
    noms = noms == null ? [0, 1] : noms
    gasPrice = bn.from(gasPrice || '5'+'0'.repeat(9))
    gasToken = ethers.utils.getAddress(gasToken || TOKENS.WBNB)

    const cachePairs = {}
    async function findPair(swap, inputToken, outputToken) {
        const keyF = `${swap}-PairCreated-${inputToken}-${outputToken}`
        if (cachePairs[keyF]) {
            return { address: cachePairs[keyF] }
        }
        const keyB = `${swap}-PairCreated-${outputToken}-${inputToken}`
        if (cachePairs[keyB]) {
            return { address: cachePairs[keyB], backward: true }
        }
        const object = await ConfigModel.findOne(({ key: { $in: [ keyF, keyB ] } })).lean()
        if (object) {
            cachePairs[object.key] = object.value
            return { address: object.value, backward: object.key == keyB }
        }
        return {}
    }

    const cacheReserves = {}
    async function getReserves(swap, inputToken, outputToken) {
        const { address, backward } = await findPair(swap, inputToken, outputToken)
        if (cacheReserves[address]) {
            const [ r0, r1 ] = cacheReserves[address]
            return backward ? [ r1, r0 ] : [ r0, r1 ]
        }
        const key = `pair-Sync-${address}`
        const reserve = await ConfigModel.findOne(({ key })).lean().then(m => m && m.value)
        if (!reserve) {
            cacheReserves[address] = []
            return []
        }
        const [ r0, r1 ] = reserve.split('/').map(r => bn.from('0x'+r))

        if (process.env.DEBUG) {
            const contract = new ethers.Contract(address, UniswapV2Pair, getProvider())
            if (contract) {
                const { _reserve0, _reserve1 } = await contract.callStatic.getReserves()
                const a = r0.mul(_reserve1)
                const b = r1.mul(_reserve0)
                const acc = a.mul(1000).div(b).sub(1000).toNumber()/10
                if (acc < -0.1 || acc > 0.1) {
                    console.error(`Reserve accurracy: ${acc}% ${swap} ${inputToken} ${outputToken}`)
                }
            }
        }

        cacheReserves[address] = [ r0, r1 ]
        return backward ? [ r1, r0 ] : [ r0, r1 ]
    }

    async function getAmountOut(swap, inputToken, outputToken, amountIn) {
        if (!ROUTERS.hasOwnProperty(swap)) {
            return 0
        }
        const [ rin, rout ] = await getReserves(swap, inputToken, outputToken)
        if (!rin || !rout) {
            return 0
        }
        const amountOut = await getAmountOutByReserves(swap, amountIn, rin, rout)
        const slippage = amountOut.mul(rin).mul(100).div(amountIn).div(rout)
        if (slippage < 80) {
            return 0    // SLIPPAGE
        }
        return amountOut
    }

    let _cacheGasRoute
    async function getGasAsToken(token, wei) {
        if (_cacheGasRoute) {
            const { swap, path } = _cacheGasRoute
            const amountOut = await getRouteAmountOut(swap, path, wei)
            if (amountOut && !amountOut.isZero()) {
                return amountOut
            }
        }
        for (const mids of MULTI_MIDS) {
            for (const mid of mids) {
                const path = [ gasToken, ...mid, token ]
                for (const swap in ROUTERS) {
                    const amountOut = await getRouteAmountOut(swap, path, wei)
                    if (amountOut && !amountOut.isZero()) {
                        _cacheGasRoute = { swap, path }
                        return amountOut
                    }
                }
            }
        }
    }

    async function getRouteAmountOut(swap, path, amount) {
        for (let i = 1; i < path.length; ++i) {
            if (!amount || amount.isZero()) {
                return
            }
            amount = await getAmountOut(swap, path[i-1], path[i], amount)
        }
        return amount
    }

    function getRouteAmountOuts(inputToken, outputToken, amount, chunks) {
        const total = sum(chunks)
        return Bluebird.map(DEXES, async ({swap, mid}, i, n) => {
            if (!chunks[i]) return
            const amountIn = amount.mul(chunks[i]).div(total)
            if (!amountIn || amountIn.isZero()) {
                return
            }
            let path = [inputToken, outputToken]
            if (mid) {
                if (path.includes(mid)) {
                    return
                }
                path = [inputToken, mid, outputToken]
            }
            const amountOut = await getRouteAmountOut(swap, path, amountIn)
            if (!amountOut || amountOut.isZero()) {
                return
            }
            return { swap, amountOut, mid }
        })
    }

    const midFee = await getGasAsToken(outputToken, gasPrice.mul(hopsGas(1)))
    console.log({midFee: midFee.toString()})

    async function getBestDistribution(inputToken, outputToken, amountIn) {
        function amountOutSubFee(out) {
            return out.mid ? out.amountOut.sub(midFee) : out.amountOut
        }

        function sumOut(outs) {
            return outs.reduce((total, out) => {
                if (!out || !out.amountOut || out.amountOut.isZero()) {
                    return total
                }
                return total.add(out.amountOut)
            }, bn.from(0))
        }

        function sumOutSubFee(outs) {
            return outs.reduce((total, out) => {
                if (!out || !out.amountOut || out.amountOut.isZero()) {
                    return total
                }
                return total.add(amountOutSubFee(out))
            }, bn.from(0))
        }

        let chunks = new Array(DEXES.length).fill(Math.floor(128))
        let outs
        let failedChunks

        for (let i = 0; i < 64; ++i) {
            let matrix = [ chunks ]
            if (failedChunks && failedChunks.length) {
                for (let shift = 1; shift <= 2; ++shift) {
                    matrix.push(chunks.map((c, ci) => failedChunks.includes(ci) ? c >> shift : c))
                }
            } else if (outs) {
                // TODO: reduce by priority and last amountOut
                for (let j in chunks) {
                    if (chunks[j]) {
                        const removedOneChunks = [...chunks]
                        removedOneChunks[j] = 0
                        matrix.push(removedOneChunks)
                        const halfOneChunks = [...chunks]
                        halfOneChunks[j] >>= 1
                        matrix.push(halfOneChunks)
                    }
                }
            }
            matrix = matrix.filter(m => m)

            const matrixOuts = await Bluebird.map(matrix, chunks => getRouteAmountOuts(inputToken, outputToken, amountIn, chunks))
            // const matrixSumOut = matrixOuts.map(outs => sumOut(outs))
            const matrixSumOutSubFee = matrixOuts.map(outs => sumOutSubFee(outs))
            // console.error(matrixSumOutSubFee.map(s => s.toString()))

            const bestIndex = matrixSumOutSubFee.reduce((bestIndex, v, i) => v.gt(matrixSumOutSubFee[bestIndex]) ? i : bestIndex, 0)
            chunks = matrix[bestIndex]
            outs = matrixOuts[bestIndex]

            // console.error(chunks, bestIndex)

            failedChunks = outs.reduce((failedChunks, s, i) => {
                if (chunks[i] && (!s || !s.amountOut || s.amountOut.isZero())) {
                    failedChunks.push(i)
                }
                return failedChunks
            }, [])

            if (failedChunks.length) {
                // console.error(failedChunks)
                continue
            }

            if (bestIndex == 0 && i > 0) {
                break
            }
        }

        const amountOut = sumOut(outs)
        // console.error({amountOut: amountOut.toString()})

        // console.error(chunks, outs.filter(out => out))
        return [ amountOut, chunks, outs.filter(out => out) ]
    }

    return await Bluebird.map(noms, findBest).filter(best => best)

    async function findBest(nom) {
        if (nom >= MULTI_MIDS.length) {
            throw new Error('nom out of range: ' + nom)
        }
        const best = {
            amount: bn.from(0),
            distribution: [],
            path: [],
            pathRoutes: [],
        }

        for (const mids of MULTI_MIDS[nom]) {
            const tokens = _.flatten([inputToken, mids, outputToken])
                .filter((t, i, tokens) => t != tokens[i-1] != t)    // remove adjenced duplicates

            let pathAmountOut = bn.from(amountIn)
            const distribution = new Array(DEXES.length).fill('')
            const dexes = []
            for (let i = 1; i < tokens.length; ++i) {
                const [ amountOut, dist, routes ] = await getBestDistribution(tokens[i-1], tokens[i], pathAmountOut)

                for (let j = 0; j < distribution.length; ++j) {
                    distribution[j] = dist[j] + (distribution[j] << 8)
                }

                dexes.push(routes)
                pathAmountOut = amountOut
            }
            // console.error({amountOut, distribution, tokens})
            if (pathAmountOut.gt(best.amount)) {
                // console.error(amountOut.toString())
                best.amount = pathAmountOut
                best.distribution = distribution.map(d => '0x'+d)
                best.path = tokens
                best.pathRoutes = dexes
            }
        }

        if (!best.amount || best.amount.isZero()) {
            return
        }

        let hops = 0
        const routeNames = best.pathRoutes.map(dx => dx.map(d => {
            if (!d.mid) {
                hops++
                return d.swap
            }
            hops += 2
            return `${d.swap} over ${tokenName(d.mid)}`
        }))
        const routeList = []
        for (let i = 0; i < best.path.length; ++i) {
            routeList.push(tokenName(best.path[i]))
            if (i < routeNames.length) {
                routeList.push(routeNames[i])
            }
        }

        const predictedGas = predictGas(hops)
        const fee = await getGasAsToken(outputToken, gasPrice.mul(predictedGas))

        console.log('=========', {nom, hops, predictedGas})
        console.log(routeList)
        console.log('amountOut', best.amount.toString(), '-', fee.toString(), '=', best.amount.sub(fee).toString())

        if (process.env.VERIFY) {
            const flag = 0x0 // 0x40000
            const flags = new Array(best.path.length-1).fill(flag)

            const { data } = await CONTRACTS.swapX.populateTransaction.swapMulti(
                best.path,
                amountIn,
                0,
                best.distribution,
                flags,
                trader,
            )

            const params = [
                inputToken,
                outputToken,
                trader,
                amountIn,
                1,
                trader,
                data,
                {
                    gasLimit: predictedGas * 2,
                    from: trader,
                }
            ]

            try {
                const returnAmount = await CONTRACTS.swapXProxy.callStatic.swap(...params)
                console.log('returnAmount', returnAmount.toString())
                const accuracy = returnAmount.mul(10000).div(best.amount).toNumber() / 100
                console.log(`accuracy ${accuracy}%`)
                const gas = await CONTRACTS.swapXProxy.estimateGas.swap(...params)
                console.log('estimatedGas', gas.toString(), `= ${gas.mul(10000).div(predictedGas).toNumber()/100}%`)
            } catch (err) {
                console.error('Error', err.reason || err)
                // await getRouteAmountOuts(inputToken, outputToken, amountIn, true)
            }
        }

        return {
            amountOut: best.amount.toString(),
            tokens: best.path,
            distribution: best.distribution,
            estimatedGas: predictedGas,
            feeInOutputToken: fee.toString(),
        }
    }
}

exports.findPath = findPath