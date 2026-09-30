'use strict';

const express = require('express');
const { ownerAuth } = require('./ownerAuth.cjs');
const policyStore = require('../../services/ai-assistant/domainPolicyStore.cjs');

const router = express.Router();
function actor(req) { return req.aiAssistantOwner?.sub || ''; }
function sendError(res, error) { return res.status(error.statusCode || 400).json({ success: false, code: error.code || 'DOMAIN_POLICY_FAILED', error: error.message || '工厂规则操作失败。' }); }

router.get('/api/ai/domain-policy', ownerAuth, (req, res) => {
    try { res.json({ success: true, data: policyStore.getCurrentPolicy() }); } catch (error) { sendError(res, error); }
});
router.get('/api/ai/domain-policy/versions', ownerAuth, (req, res) => {
    try { res.json({ success: true, data: { versions: policyStore.listVersions(), audit: policyStore.listAudit() } }); } catch (error) { sendError(res, error); }
});
router.get('/api/ai/domain-policy/diff', ownerAuth, (req, res) => {
    try { res.json({ success: true, data: policyStore.getDiff({ from: req.query.from, to: req.query.to }) }); } catch (error) { sendError(res, error); }
});
router.put('/api/ai/domain-policy/draft', ownerAuth, (req, res) => {
    try { res.json({ success: true, data: policyStore.saveDraft(req.body || {}, { actor: actor(req) }) }); } catch (error) { sendError(res, error); }
});
router.post('/api/ai/domain-policy/publish', ownerAuth, (req, res) => {
    try { res.json({ success: true, data: policyStore.publishDraft(req.body || {}, { actor: actor(req) }) }); } catch (error) { sendError(res, error); }
});
router.post('/api/ai/domain-policy/rollback', ownerAuth, (req, res) => {
    try { res.json({ success: true, data: policyStore.rollbackPolicy(req.body || {}, { actor: actor(req) }) }); } catch (error) { sendError(res, error); }
});

module.exports = { router };
