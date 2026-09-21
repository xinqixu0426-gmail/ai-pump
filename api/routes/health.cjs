const { Router } = require('express');
const { db, getBackupRuntimeState } = require('../db.cjs');
const { buildReadinessSnapshot } = require('../services/serviceHealth.cjs');
const { runtimeDiagnostics } = require('../services/runtimeDiagnostics.cjs');

const router = Router();

router.get('/live', (_req, res) => {
    res.json({
        success: true,
        data: {
            status: 'alive',
            timestamp: new Date().toISOString(),
        },
    });
});

function readinessHandler(_req, res) {
    const backupState = getBackupRuntimeState();
    const snapshot = buildReadinessSnapshot(db, { backupState });
    snapshot.runtime = runtimeDiagnostics();
    snapshot.background = {
        databaseBackup: backupState,
        knowledgeSync: require('../services/knowledgeAutoSync.cjs').getAutoKnowledgeSyncStatus(),
        knowledgeVectorSync: require('../services/knowledgeVectorAutoSync.cjs').getKnowledgeVectorSyncStatus(),
        managementActionLifecycle: require('../services/managementActionLifecycle.cjs')
            .getManagementActionLifecycleMonitorStatus(),
    };
    const statusCode = snapshot.ready ? 200 : 503;
    res.status(statusCode).json({
        success: snapshot.ready,
        status: snapshot.ready ? 'ok' : 'not_ready',
        message: snapshot.ready ? '水泵工厂管理系统 API 已就绪' : '水泵工厂管理系统 API 尚未就绪',
        timestamp: snapshot.timestamp,
        data: snapshot,
        ...(!snapshot.ready ? { error: '服务启动检查尚未全部通过' } : {}),
    });
}

router.get('/ready', readinessHandler);
router.get('/', readinessHandler);

module.exports = router;
module.exports.readinessHandler = readinessHandler;
