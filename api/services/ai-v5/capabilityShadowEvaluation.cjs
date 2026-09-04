'use strict';

const { createV5Task } = require('./contracts.cjs');
const { buildToolCapabilityReverseIndex } = require('./capabilityRegistry.cjs');
const { routeV5Capability } = require('./capabilityRouter.cjs');

function firstActualTool(testCase) {
    const tools = testCase?.safe_structural_metadata?.tools;
    return Array.isArray(tools) && typeof tools[0] === 'string' ? tools[0] : null;
}

function analyzeP06R02Cases(cases, reverseIndex = buildToolCapabilityReverseIndex()) {
    return Object.freeze((Array.isArray(cases) ? cases : [])
        .filter(testCase => testCase?.failure_class === 'R02')
        .map(testCase => {
            const expectedTool = testCase?.expected?.primary_tool || null;
            const actualTool = firstActualTool(testCase);
            const expectedCapabilities = expectedTool ? reverseIndex[expectedTool] || [] : [];
            const actualCapabilities = actualTool ? reverseIndex[actualTool] || [] : [];
            let classification = 'UNKNOWN';
            if (expectedCapabilities.length === 1 && actualCapabilities.length > 0) {
                classification = actualCapabilities.includes(expectedCapabilities[0])
                    ? 'NOT_BLOCKED_SAME_CAPABILITY'
                    : 'BLOCKED_BY_LIMITED_EXPOSURE';
            }
            return Object.freeze({
                caseId: testCase.case_id,
                expectedTool,
                expectedCapability: expectedCapabilities.length === 1 ? expectedCapabilities[0] : null,
                actualTool,
                actualCapabilities: Object.freeze([...actualCapabilities]),
                classification,
            });
        }));
}

function safeStructuredRouteInput(testCase) {
    const input = testCase?.safe_structural_metadata?.capability_route_input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const { domain, operation, entityType, explicitCapability } = input;
    if (![domain, operation, entityType].every(value => typeof value === 'string' && value.length > 0)) return null;
    return { domain, operation, entityType, explicitCapability: explicitCapability || null };
}

function evaluateP06CapabilityRouting(cases, timestamp = '2026-01-01T00:00:00.000Z') {
    const reverse = buildToolCapabilityReverseIndex();
    const outcomes = (Array.isArray(cases) ? cases : []).map(testCase => {
        const expectedTool = testCase?.expected?.primary_tool || null;
        const expectedCapabilities = expectedTool ? reverse[expectedTool] || [] : [];
        const structuredInput = safeStructuredRouteInput(testCase);
        if (!structuredInput) {
            return Object.freeze({
                caseId: testCase?.case_id || null,
                outcome: 'INSUFFICIENT_DATA',
                expectedCapability: expectedCapabilities.length === 1 ? expectedCapabilities[0] : null,
                selectedCapability: null,
                correct: null,
            });
        }
        const task = createV5Task({
            version: 1,
            taskId: `p06-shadow-${testCase.case_id}`,
            state: 'ROUTING',
            createdAt: timestamp,
            updatedAt: timestamp,
            intent: null,
            entityContext: [],
            requestedCapability: null,
            execution: {},
            verification: null,
            failure: null,
            metadata: {},
            stateHistory: [],
        });
        const route = routeV5Capability(task, structuredInput);
        const expectedCapability = expectedCapabilities.length === 1 ? expectedCapabilities[0] : null;
        return Object.freeze({
            caseId: testCase.case_id,
            outcome: route.outcome,
            expectedCapability,
            selectedCapability: route.capabilityId,
            correct: route.outcome === 'SELECTED' && expectedCapability
                ? route.capabilityId === expectedCapability
                : null,
        });
    });
    const routable = outcomes.filter(item => item.outcome !== 'INSUFFICIENT_DATA');
    const authoritative = routable.filter(item => item.expectedCapability !== null && item.outcome === 'SELECTED');
    const correct = authoritative.filter(item => item.correct === true).length;
    const incorrect = authoritative.filter(item => item.correct === false).length;
    const ambiguous = routable.filter(item => item.outcome === 'AMBIGUOUS').length;
    return Object.freeze({
        outcomes: Object.freeze(outcomes),
        metrics: Object.freeze({
            evaluated: outcomes.length,
            routable: routable.length,
            insufficientData: outcomes.filter(item => item.outcome === 'INSUFFICIENT_DATA').length,
            correct,
            incorrect,
            ambiguous,
            accuracy: authoritative.length > 0 ? correct / authoritative.length : null,
        }),
    });
}

module.exports = {
    analyzeP06R02Cases,
    evaluateP06CapabilityRouting,
    firstActualTool,
    safeStructuredRouteInput,
};
