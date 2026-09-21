function rotorHistoryRow(row) {
    if (!row) return row;
    const normalized = {
        id: row.id,
        jobId: row.job_id,
        drawingName: row.drawing_name || '',
        nlInput: row.nl_input || '',
        paramsJson: row.params_json || '{}',
        fcParamsJson: row.fc_params_json || '{}',
        status: row.status || '',
        fileUrl: row.file_url || '',
        error: row.error || '',
        linkedPumpModel: row.linked_pump_model || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };

    return {
        ...normalized,
        // legacy fields retained during API contract migration.
        job_id: normalized.jobId,
        drawing_name: normalized.drawingName,
        nl_input: normalized.nlInput,
        params_json: normalized.paramsJson,
        fc_params_json: normalized.fcParamsJson,
        file_url: normalized.fileUrl,
        linked_pump_model: normalized.linkedPumpModel,
        created_at: normalized.createdAt,
        updated_at: normalized.updatedAt,
    };
}

function listRotorHistory(db, limit = 100) {
    const normalizedLimit = Math.min(
        500,
        Math.max(1, Number.parseInt(limit, 10) || 100)
    );
    return db.prepare(`
        SELECT *
        FROM rotor_drawings
        ORDER BY created_at DESC
        LIMIT ?
    `).all(normalizedLimit).map(rotorHistoryRow);
}

function getRotorJobStatus(db, jobId, activeJobs) {
    const active = activeJobs?.get(String(jobId || ''));
    if (active) return active;
    const row = db.prepare(`
        SELECT drawing_name, status, file_url, error
        FROM rotor_drawings
        WHERE job_id = ?
    `).get(String(jobId || ''));
    if (!row) return null;
    return {
        status: row.status || 'not_found',
        drawingName: row.drawing_name || '',
        fileUrl: row.file_url || '',
        error: row.error || '',
    };
}

module.exports = {
    getRotorJobStatus,
    listRotorHistory,
    rotorHistoryRow,
};
