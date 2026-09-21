const { Router } = require('express');
const router = Router();

// 挂载子路由
const chatModule = require('./ai/chat.cjs');
const promptModule = require('./ai/prompt.cjs');
const conversationsRouter = require('./ai/conversations.cjs');
const feedbackRouter = require('./ai/feedback.cjs');
const evaluationsRouter = require('./ai/evaluations.cjs');

router.use('/', conversationsRouter);
router.use('/', feedbackRouter);
router.use('/', require('./ai/personalMemory.cjs'));
router.use('/', evaluationsRouter);
router.use('/', chatModule.router);
router.use('/', promptModule.router);

module.exports = router;
module.exports.loadSystemPromptFromDB = promptModule.loadSystemPromptFromDB;
