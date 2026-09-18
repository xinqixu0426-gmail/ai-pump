// Historical two-stage fixtures exercise the preserved implementation explicitly.
// The public/default entry is covered by aiAssistantRuntime and chat transport tests.
const { runAiAgentRuntimeV3 } = require('../../api/services/aiAgentRuntimeV3.cjs');
const runAiDispatcherV3 = input => runAiAgentRuntimeV3({ ...input, agentVersion: 3 });
const processAiChat = (text, options = {}) => runAiDispatcherV3({ ...options, stream: false, messages: [...(options.context || []), { role: 'user', content: text }] });
module.exports = { runAiDispatcherV3, processAiChat };
