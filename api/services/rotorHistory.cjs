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

module.exports = { rotorHistoryRow };
