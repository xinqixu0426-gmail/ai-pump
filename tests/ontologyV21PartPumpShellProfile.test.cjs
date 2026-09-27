'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ontologyV2 } = require('../api/ontology/v2/contract.cjs');
const { validateOntologyV2 } = require('../api/ontology/v2/validator.cjs');
const { ontologyV21 } = require('../api/ontology/v2_1/contract.cjs');
const { validateOntologyV21 } = require('../api/ontology/v2_1/validator.cjs');
const { partProfile, pumpShellExtension, pumpShellExtensionId } = require('../api/ontology/v2_1/entities/part.cjs');
const { templateSupportingProfile, templateUsesShellPartRelation } = require('../api/ontology/v2_1/entities/template.cjs');

const clone = value => JSON.parse(JSON.stringify(value));

function profile(entityType, contract = ontologyV21) {
    return contract.profiles.find(item => item.entityType === entityType);
}

function fact(profileDefinition, factId) {
    return profileDefinition.facts.find(item => item.factId === factId);
}

test('Part base remains lightweight with a resource-owned canonical ID and non-canonical model designation', () => {
    assert.deepEqual(partProfile.identity.canonicalId, {
        sourceRef: { sourceId: 'part.current_resource', path: 'parts.id -> partRow.id', status: 'RESOLVED' },
        kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
        unique: true,
    });
    assert.equal(partProfile.identity.canonicalIdentityFactId, null);
    assert.equal(partProfile.identity.permitsDesignationAsCanonicalId, false);
    assert.equal(partProfile.identity.permitsNameOnlyCanonicalId, false);

    const designation = partProfile.designations.find(item => item.designationId === 'part.modelDesignation');
    assert.equal(designation.canonicalIdentity, false);
    assert.equal(designation.unique, false);
    assert.equal(designation.collisionPolicy, 'REPORT');

    const candidateFacts = partProfile.facts.filter(item => item.candidateSelectionEvidence).map(item => item.factId);
    assert.deepEqual(candidateFacts, ['part.model', 'part.category', 'part.subcategory', 'part.supplier']);
    ['part.price', 'part.stock'].forEach(factId => {
        assert.equal(fact(partProfile, factId).directIdentityEvidence, false, factId);
        assert.equal(fact(partProfile, factId).candidateSelectionEvidence, false, factId);
    });
    assert.equal(fact(partProfile, 'part.price').businessRoles.includes('COST_INPUT'), false);
    assert.equal(partProfile.facts.some(item => item.factId === 'part.remark'), false);
    assert.deepEqual(fact(partProfile, 'part.category').businessRoles, ['DESCRIPTIVE', 'POLICY_INPUT']);
});

test('Part lifecycle declares the raw deleted_at source without inventing a current DTO field', () => {
    const deletedAt = fact(partProfile, 'part.deletedAt');
    assert.equal(deletedAt.sourceRef.sourceId, 'part.current_resource');
    assert.match(deletedAt.sourceRef.path, /parts\.deleted_at/);
    assert.deepEqual(deletedAt.businessRoles, ['LIFECYCLE']);
    const currentSource = ontologyV21.sources.find(item => item.sourceId === 'part.current_resource');
    assert.match(currentSource.sourceOfTruth, /partRow does not currently project deletedAt/);
});

test('PumpShell is a small category extension whose only approved technical Fact is isStainless', () => {
    assert.equal(pumpShellExtension.extensionId, pumpShellExtensionId);
    assert.equal(pumpShellExtension.baseEntityType, 'part');
    assert.equal('identity' in pumpShellExtension, false);
    assert.deepEqual(pumpShellExtension.applicability, {
        kind: 'FACT_EQUALS',
        factRef: { scope: 'LOCAL', factId: 'part.category' },
        value: '泵壳',
    });
    assert.deepEqual(pumpShellExtension.facts.map(item => item.factId), ['part.isStainless']);
    const stainless = fact(pumpShellExtension, 'part.isStainless');
    assert.deepEqual(stainless.businessRoles, ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT']);
    assert.equal(stainless.directIdentityEvidence, false);
    assert.equal(stainless.candidateSelectionEvidence, false);
    assert.equal(stainless.sourceRef.sourceId, 'part.pump_shell_metadata_projection');
    assert.match(stainless.sourceRef.path, /parts\.remark\.isStainless/);
});

test('PumpShell extension excludes every frozen compatibility-only rotor/default field', () => {
    const definition = JSON.stringify(pumpShellExtension);
    [
        'openOffset', 'openFactor', 'barrelLength', 'barrelLengthPresets',
        'defaultUpperBearing', 'defaultLowerBearing', 'defaultOilSeal', 'defaultBearingSpan',
        'defaultImpeller', 'defaultThread', 'defaultStackOffset',
    ].forEach(term => assert.equal(definition.includes(term), false, term));
});

test('minimal Template profile owns the formal zero-or-one canonical shell-Part relation only', () => {
    assert.deepEqual(templateSupportingProfile.identity.canonicalId, {
        sourceRef: { sourceId: 'template.current_resource', path: 'pump_shell_templates.id -> templateRow.id', status: 'RESOLVED' },
        kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
        unique: true,
    });
    assert.equal(templateSupportingProfile.identity.permitsDesignationAsCanonicalId, false);
    assert.equal(fact(templateSupportingProfile, 'template.shellModel').directIdentityEvidence, true);
    const designation = templateSupportingProfile.designations[0];
    assert.equal(designation.canonicalIdentity, false);
    assert.equal(templateSupportingProfile.relationIds.length, 1);
    assert.equal(templateSupportingProfile.relationIds[0], 'template.uses_shell_part');

    assert.equal(templateUsesShellPartRelation.sourceEntityType, 'template');
    assert.deepEqual(templateUsesShellPartRelation.target, { entityType: 'part', canonicalEndpointRequired: true });
    assert.equal(templateUsesShellPartRelation.direction, 'OUTBOUND');
    assert.equal(templateUsesShellPartRelation.cardinality, 'ZERO_OR_ONE');
    assert.equal(templateUsesShellPartRelation.sourceRef.sourceId, 'template.shell_part_binding');
    assert.match(templateUsesShellPartRelation.sourceRef.path, /catalog_template_shell_bindings/);
    assert.equal(JSON.stringify(templateUsesShellPartRelation).includes('shellModel'), false);
});

test('Template can statically reach the PumpShell extension Fact only with its target extension qualifier', () => {
    const valid = clone(ontologyV21);
    profile('template', valid).policyIds.push('template.shell_extension_path_proof');
    valid.policies.push({
        policyId: 'template.shell_extension_path_proof',
        ownerEntityType: 'template',
        factRefs: [{
            scope: 'RELATED',
            relationPath: ['template.uses_shell_part'],
            factId: 'part.isStainless',
            targetExtensionId: pumpShellExtensionId,
        }],
        relationIds: ['template.uses_shell_part'],
        rules: [],
        runtimeEnabled: false,
    });
    assert.doesNotThrow(() => validateOntologyV21(valid));

    const missingQualifier = clone(valid);
    delete missingQualifier.policies[0].factRefs[0].targetExtensionId;
    assert.throws(() => validateOntologyV21(missingQualifier), error => error.code === 'ONTOLOGY_V21_FACT_REF_INVALID');
});

test('registered profiles validate, leave V2 Coil untouched, and have no business-service imports', () => {
    assert.deepEqual(validateOntologyV2(ontologyV2), {
        version: 2, sourceCount: 7, profileCount: 1, factCount: 28, designationCount: 1, runtimeEnabled: false,
    });
    assert.deepEqual(validateOntologyV21(ontologyV21), {
        version: 2,
        contractRevision: '2.1',
        sourceCount: 12,
        profileCount: 3,
        extensionCount: 1,
        relationCount: 1,
        policyCount: 0,
        technicalKnowledgeTypeCount: 0,
        factCount: 39,
        derivedFactCount: 0,
        relationProjectionFactCount: 0,
        runtimeEnabled: false,
    });
    assert.equal(profile('part'), partProfile);
    assert.equal(profile('template'), templateSupportingProfile);

    const entitiesDirectory = path.join(__dirname, '..', 'api', 'ontology', 'v2_1', 'entities');
    const forbiddenImports = [/\/db(?:\.cjs)?['"]\)/, /services\//, /costEngine/, /recipeBomEngine/, /routes\//, /tools\.cjs/];
    fs.readdirSync(entitiesDirectory).filter(file => file.endsWith('.cjs')).forEach(file => {
        const content = fs.readFileSync(path.join(entitiesDirectory, file), 'utf8');
        forbiddenImports.forEach(pattern => assert.doesNotMatch(content, pattern, file));
    });
});
