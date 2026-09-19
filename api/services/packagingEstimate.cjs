function text(value) {
    return String(value || '').trim();
}

function isPackagingEstimatePart(part = {}) {
    const identity = `${text(part.model)} ${text(part.name)}`;
    return identity.includes('估算')
        && (identity.includes('外包装') || identity.includes('包装'));
}

module.exports = {
    isPackagingEstimatePart,
};
