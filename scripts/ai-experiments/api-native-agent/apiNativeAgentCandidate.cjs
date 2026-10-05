'use strict';

// Acceptance instrumentation stays in scripts, but the investigated Agent
// itself is the production-owned Native core.  Do not add behavior here.
module.exports = require('../../../api/services/ai-assistant/nativeAgentCore.cjs');
