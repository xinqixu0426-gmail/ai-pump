'use strict';
const {main,FREEZE}=require('./certify-v5-collections.cjs');
FREEZE.push('api/services/ai-v5/collectionAdmission.cjs','api/services/ai-v5/collectionDetailTarget.cjs',
    'api/services/entityLookupService.cjs','api/services/ai-v5/typeIndependentEntityResolver.cjs');
main({output:'docs/ai-governance/data/p16lr2-collection-certification.json',stage:'P16-L-R2'})
    .catch(()=>{process.stdout.write('R2_CERTIFICATION_FAILED\n');process.exitCode=1;});
