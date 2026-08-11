const { runAiAgentRuntimeV3 } = require('./aiAgentRuntimeV3.cjs');

async function runAiDispatcherV3(input = {}) {
    return runAiAgentRuntimeV3({
        ...input,
        agentVersion: 3,
    });
}

module.exports = { runAiDispatcherV3 };
