const { postJson } = require('../internalApiClient.cjs');

async function recordWorkflowRun(internalFetch, input) {
    try {
        const commandFetch = typeof internalFetch.createChildOperationFetch === 'function'
            ? internalFetch.createChildOperationFetch()
            : internalFetch;
        const run = await postJson(
            commandFetch,
            '/api/workbench/execution-runs',
            input,
            '执行历史保存失败'
        );
        return { run, warning: '' };
    } catch (error) {
        return {
            run: null,
            warning: `业务动作已按实时状态处理，但执行历史保存失败：${error.message}`,
        };
    }
}

module.exports = {
    recordWorkflowRun,
};
