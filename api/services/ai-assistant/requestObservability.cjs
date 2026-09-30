'use strict';

// Request-scoped metadata only.  This deliberately records neither prompt,
// response, tool arguments, entity identifiers nor business values.
const { createLogger } = require('../../logger.cjs');

const logger = createLogger('ai-assistant-runtime');

function elapsed(startedAt) { return Math.max(0, Date.now() - startedAt); }
function boundedNames(values, max = 16) {
    return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, max);
}

function createRequestObservability(input = {}) {
    const startedAt = Date.now();
    const stages = Object.create(null);
    const summary = {
        requestId: String(input.requestId || '').trim() || null,
        policyVersion: input.policyVersion || null,
        routeClass: input.routeClass || 'GENERAL',
        judgeUsed: false,
        judgeModelCalls: 0,
        mainModelCalls: 0,
        answerRewriteCalls: 0,
        selectedDomains: [],
        selectedCapabilities: [],
        exposedToolCount: 0,
        actualToolCalls: 0,
        ontologyResolutionCount: 0,
        factCount: 0,
        goalCount: 0,
        goalStatuses: [],
        validatorResult: null,
        writeProposalCreated: false,
        writeExecuted: false,
        tokenUsage: 'UNAVAILABLE',
    };
    return Object.freeze({
        stage(name, operation) {
            const stageStartedAt = Date.now();
            const finish = () => { stages[name] = (stages[name] || 0) + elapsed(stageStartedAt); };
            if (typeof operation !== 'function') { finish(); return undefined; }
            try {
                const value = operation();
                if (value && typeof value.then === 'function') return value.finally(finish);
                finish(); return value;
            } catch (error) { finish(); throw error; }
        },
        update(values = {}) {
            if (values.selectedDomains) values.selectedDomains = boundedNames(values.selectedDomains);
            if (values.selectedCapabilities) values.selectedCapabilities = boundedNames(values.selectedCapabilities);
            if (values.goalStatuses) values.goalStatuses = boundedNames(values.goalStatuses, 12);
            Object.assign(summary, values);
        },
        snapshot() {
            return Object.freeze({
                ...summary,
                timings: Object.freeze({
                    contextBuildMs: stages.contextBuild || 0,
                    ontologyMs: stages.ontology || 0,
                    brokerMs: stages.broker || 0,
                    judgeMs: stages.judge || 0,
                    mainAgentMs: stages.mainAgent || 0,
                    toolMs: stages.tool || 0,
                    factProjectionMs: stages.factProjection || 0,
                    answerValidationMs: stages.answerValidation || 0,
                    totalLatencyMs: elapsed(startedAt),
                }),
            });
        },
        emit(result = 'COMPLETED') {
            const snapshot = this.snapshot();
            logger.info('AI assistant request completed', {
                requestId: snapshot.requestId,
                policyVersion: snapshot.policyVersion,
                routeClass: snapshot.routeClass,
                judgeUsed: snapshot.judgeUsed,
                judgeModelCalls: snapshot.judgeModelCalls,
                mainModelCalls: snapshot.mainModelCalls,
                answerRewriteCalls: snapshot.answerRewriteCalls,
                selectedDomains: snapshot.selectedDomains,
                selectedCapabilities: snapshot.selectedCapabilities,
                exposedToolCount: snapshot.exposedToolCount,
                actualToolCalls: snapshot.actualToolCalls,
                ontologyResolutionCount: snapshot.ontologyResolutionCount,
                factCount: snapshot.factCount,
                goalCount: snapshot.goalCount,
                goalStatuses: snapshot.goalStatuses,
                validatorResult: snapshot.validatorResult,
                writeProposalCreated: snapshot.writeProposalCreated,
                writeExecuted: snapshot.writeExecuted,
                timings: snapshot.timings,
                result,
            });
            return snapshot;
        },
    });
}

module.exports = { createRequestObservability };
