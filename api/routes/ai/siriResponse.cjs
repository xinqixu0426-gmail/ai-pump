function limitText(text, maxLength = 80) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, maxLength - 1) + '…';
}

function isConfirmationResult(result) {
    return Boolean(result && result.requiresConfirmation && result.confirmation?.toolName);
}

function findPendingConfirmation(toolResults) {
    return (toolResults || []).find(item => isConfirmationResult(item?.result));
}

function firstFailedTool(toolResults) {
    return (toolResults || []).find(item => item?.result?.success === false);
}

function firstBackgroundTask(toolResults) {
    const item = (toolResults || []).find(row => row?.result?.jobId || row?.result?.statusUrl);
    if (!item) return null;
    return {
        id: item.result.jobId || '',
        type: item.name,
        statusUrl: item.result.statusUrl || '',
        estimatedSeconds: item.name === 'generate_rotor_drawing' ? 30 : undefined,
    };
}

function classifySiriResult(toolResults) {
    const pending = findPendingConfirmation(toolResults);
    if (pending) return { status: 'confirmation_required', pending };

    const failed = firstFailedTool(toolResults);
    if (failed) return { status: 'failed', failed };

    const task = firstBackgroundTask(toolResults);
    if (task) return { status: 'processing', task };

    return { status: 'success' };
}

function buildSiriSpeech({ status, aiSpeech, pending, failed, task }) {
    if (status === 'confirmation_required') {
        const title = pending?.result?.confirmation?.title || '这个操作';
        return `${title}需要确认。`;
    }
    if (status === 'processing') {
        return task?.id ? `任务已提交，编号${task.id}。` : '任务已提交。';
    }
    if (status === 'failed') {
        const error = failed?.result?.error || '执行失败';
        return limitText(String(error), 60);
    }
    return limitText(aiSpeech || '已完成。', 60);
}

module.exports = {
    limitText,
    isConfirmationResult,
    classifySiriResult,
    buildSiriSpeech,
    firstBackgroundTask,
};
