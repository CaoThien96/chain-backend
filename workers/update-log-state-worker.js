const _ = require('lodash')
const { ethers } = require('ethers')
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC)
const contractABI = require('../ABIs/SFarm.json').abi
const LogsStateModel = require('../models/LogsStateModel')
const mongoose = require("mongoose");
const { delay } = require('bluebird')
const { updateLogsState } = require('../services/update-logs-state')
mongoose.set("useFindAndModify", false);

const SFarm = new ethers.Contract(process.env.FARM, contractABI, provider)

const processMaskLogs = ({ logs }) => {
    return _.pickBy(logs
        .map(({ data, topics }) => ({
            ['0x' + topics[1].substr(26)]: parseInt(data),
        }))
        .reduce((a, b) => ({ ...a, ...b }), {})
    )
}

const processAdminLogs = async ({ logs }) => {
    const stateValue = processMaskLogs({
        logs: logs.filter(log => log.topics[0] === SFarm.filters.AuthorizeAdmin(null, null).topics[0])
    });

    const lastState = await LogsStateModel.findOne({
        key: 'admins',
    }).lean();
    
    await LogsStateModel.updateOne(
        { key: 'admins' },
        {
            value: {
                ...(lastState && lastState.value),
                ...stateValue,
            }
        },
        { upsert: true },
    );
};

const processFarmerLogs = async ({ logs }) => {
    const stateValue = processMaskLogs({
        logs: logs.filter(log => log.topics[0] === SFarm.filters.AuthorizeFarmer(null, null).topics[0])
    })

    const lastState = await LogsStateModel.findOne({
        key: 'farmers',
    }).lean();

    await LogsStateModel.updateOne(
        { key: 'farmers' },
        {
            value: {
                ...(lastState && lastState.value),
                ...stateValue,
            }
        },
        { upsert: true },
    );
};

const processRouterLogs = async ({ logs }) => {
    const stateValue = processMaskLogs({
        logs: logs.filter(log => log.topics[0] === SFarm.filters.AuthorizeRouter(null, null).topics[0])
    })

    const lastState = await LogsStateModel.findOne({
        key: 'routers',
    }).lean();

    await LogsStateModel.updateOne(
        { key: 'routers' },
        {
            value: {
                ...(lastState && lastState.value),
                ...stateValue,
            }
        },
        { upsert: true },
    );
}

const processTokenLogs = async ({ logs }) => {
    const stateValue = processMaskLogs({
        logs: logs.filter(log => log.topics[0] === SFarm.filters.AuthorizeToken(null, null).topics[0])
    })

    const lastState = await LogsStateModel.findOne({
        key: 'tokens',
    }).lean();

    await LogsStateModel.updateOne(
        { key: 'tokens' },
        {
            value: {
                ...(lastState && lastState.value),
                ...stateValue,
            }
        },
        { upsert: true },
    );
}

const configs = {
    admins: {
        getFilter: async () => ({
            ...SFarm.filters.AuthorizeAdmin(null, null),
        }),
        processLogs: processAdminLogs,
    },
    routers: {
        getFilter: async () => ({
            ...SFarm.filters.AuthorizeRouter(null, null),
        }),
        processLogs: processRouterLogs,
    },
    farmers: {
        getFilter: async () => ({
            ...SFarm.filters.AuthorizeFarmer(null, null),
        }),
        processLogs: processFarmerLogs,
    },
    tokens: {
        getFilter: async () => ({
            ...SFarm.filters.AuthorizeToken(null, null),
        }),
        processLogs: processTokenLogs,
    },
};

let updating = false;
provider.on('block', async () => {
    if (updating === true) {
        return;
    }
    try {
        updating = true;
        await updateLogsState({ configs })
    } catch (error) {
        console.error(error.message)
    } finally {
        updating = false;
    }
})