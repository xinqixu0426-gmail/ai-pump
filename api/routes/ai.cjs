const { Router } = require('express');
const router = Router();

// 挂载子路由
const chatModule = require('./ai/chat.cjs');
const voiceRouter = require('./ai/voice.cjs');
const siriRouter = require('./ai/siri.cjs');
const promptModule = require('./ai/prompt.cjs');
const conversationsRouter = require('./ai/conversations.cjs');

router.use('/', conversationsRouter);
router.use('/', chatModule.router);
router.use('/', voiceRouter);
router.use('/', siriRouter);
router.use('/', promptModule.router);

module.exports = router;
module.exports.loadSystemPromptFromDB = promptModule.loadSystemPromptFromDB;
