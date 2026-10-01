'use strict';

function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s，。！？、:：；;,.!?()（）"'`]/g, '');
}
function containsAny(text, terms) {
    const normalized = normalize(text);
    return terms.some(term => normalized.includes(normalize(term)));
}
function contextProfiles() {
    return Object.freeze({
        business: Object.freeze({ companyBusinessModelIncluded: true, domainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 }),
        policy: Object.freeze({ companyBusinessModelIncluded: false, domainPolicyIncluded: true, ontologyIncluded: false, toolsExposed: 0 }),
        intent: Object.freeze({ rawUserInputIncluded: true, businessMemoIncluded: true, policyMemoIncluded: false, rawCompanyBusinessModelIncluded: false, rawDomainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 }),
    });
}

module.exports = { normalize, containsAny, contextProfiles };
