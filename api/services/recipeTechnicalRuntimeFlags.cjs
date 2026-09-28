const { isEnvFlagEnabled } = require('./environment.cjs');

const CANONICAL_READ_FLAG = 'RECIPE_TECHNICAL_CANONICAL_READ_ENABLED';
const LEGACY_PROJECTION_FLAG = 'RECIPE_TECHNICAL_LEGACY_PROJECTION_ENABLED';
const LEGACY_WRITE_FREEZE_FLAG = 'RECIPE_TECHNICAL_LEGACY_WRITE_FREEZE_ENABLED';

function recipeTechnicalRuntimeFlags(env = process.env) {
    return Object.freeze({
        canonicalReadEnabled: isEnvFlagEnabled(env, CANONICAL_READ_FLAG),
        legacyProjectionEnabled: isEnvFlagEnabled(env, LEGACY_PROJECTION_FLAG),
        legacyWriteFreezeEnabled: isEnvFlagEnabled(env, LEGACY_WRITE_FREEZE_FLAG),
    });
}

module.exports = {
    CANONICAL_READ_FLAG,
    LEGACY_PROJECTION_FLAG,
    LEGACY_WRITE_FREEZE_FLAG,
    recipeTechnicalRuntimeFlags,
};
