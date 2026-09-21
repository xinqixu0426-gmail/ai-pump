const express = require('express');
const dbAccessors = require('../../db.cjs');
const authMiddleware = require('../../authMiddleware.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../../services/commandRequest.cjs');
const factoryProfileService = require('../../services/factoryProfileService.cjs');

const router = express.Router();

function promptAuth(req, res, next) {
    if (
        process.env.INTERNAL_SECRET
        && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET
    ) {
        return next();
    }
    return authMiddleware(req, res, next);
}

router.get('/api/ai/system-prompt', promptAuth, (req, res) => {
    const snapshot = factoryProfileService.factoryProfileSnapshot();
    res.json({
        success: true,
        data: req.query.includeMeta === '1' ? snapshot : snapshot.prompt,
    });
});

router.put('/api/ai/system-prompt', promptAuth, (req, res) => {
    try {
        const result = factoryProfileService.executeFactoryProfileUpdate(
            dbAccessors,
            req.body || {},
            commandContextFromRequest(
                req,
                factoryProfileService.UPDATE_FACTORY_PROFILE_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: {
                ...result,
                operationStatus: result.status,
                ...result.profile,
            },
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = {
    ...factoryProfileService,
    router,
};
