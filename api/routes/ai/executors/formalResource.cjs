function canonicalApiResource(resource) {
    const {
        Id: _legacyId,
        CreatedAt: _legacyCreatedAt,
        UpdatedAt: _legacyUpdatedAt,
        ...canonical
    } = resource || {};
    return canonical;
}

module.exports = {
    canonicalApiResource,
};
