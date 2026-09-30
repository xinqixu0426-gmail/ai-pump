'use strict';

const authMiddleware = require('../../authMiddleware.cjs');
const { verifyAuthentication, isAuthenticatedOwner } = require('../../services/ownerAuthentication.cjs');

function ownerAuth(req, res, next) {
    return authMiddleware(req, res, () => {
        const auth = verifyAuthentication(req.cookies?.token, process.env);
        if (!isAuthenticatedOwner(auth, process.env)) {
            return res.status(403).json({ success: false, code: 'AI_OWNER_ONLY', error: 'AI 助手当前仅对 Owner 开放。' });
        }
        req.aiAssistantOwner = auth;
        return next();
    });
}

module.exports = { ownerAuth };
