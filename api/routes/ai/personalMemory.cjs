const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const dependencies = require('../../db.cjs');
const { listPersonalMemories, changePersonalMemory, MEMORY_CAPABILITY } = require('../../services/aiPersonalMemory.cjs');
const { commandContextFromRequest, sendCommandError } = require('../../services/commandRequest.cjs');

const router = Router();
router.use('/api/ai/personal-memories', (req, res, next) => {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) return next();
    return authMiddleware(req, res, next);
});
router.get('/api/ai/personal-memories', (req, res) => {
    try { res.json({ success: true, data: listPersonalMemories(dependencies, req.query) }); }
    catch (error) { sendCommandError(res, error); }
});
router.post('/api/ai/personal-memories/change', (req, res) => {
    try {
        const context = commandContextFromRequest(req, MEMORY_CAPABILITY);
        res.json({ success: true, data: changePersonalMemory(dependencies, req.body, context) });
    } catch (error) { sendCommandError(res, error); }
});
module.exports = router;
