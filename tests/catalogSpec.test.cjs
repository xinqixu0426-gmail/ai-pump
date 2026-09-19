const test=require('node:test');const assert=require('node:assert/strict');
const {wireValueOf,selectWirePart,capacitorValueOf}=require('../api/services/catalogSpec.cjs');
const part=(id,supplier='甲',category='电缆线')=>({id,category,supplier,model:`目录名称${id}`,price:1.45,naming:{ruleId:category==='浮球'?'float':'cable',spec:{wireValue:0.55,wireMeasure:'截面积',wireUnit:'mm²'}}});
test('结构化电缆/浮球按面积与 ID 选料，目录名称不参与规格计算',()=>{
 for(const category of ['电缆线','浮球']) {
  const selected=part(1,'甲',category);assert.equal(wireValueOf(selected),'0.55');assert.equal(selectWirePart([selected],category,'0.550'),selected);
  assert.equal(selectWirePart([selected],category,0.75),null);
  assert.throws(()=>selectWirePart([selected,part(2,'乙',category)],category,0.55),{code:'WIRE_SPEC_AMBIGUOUS'});
  assert.equal(selectWirePart([selected,part(2,'乙',category)],category,0.55,'',1),selected);
  assert.throws(()=>selectWirePart([selected],category,0.75,'',1),{code:'WIRE_SPEC_MISMATCH'});
  assert.throws(()=>selectWirePart([selected],category,0.55,'乙',1));
 }
 assert.equal(wireValueOf({category:'浮球',model:'浮球-线径0.55'}),'0.55');
 assert.equal(wireValueOf({category:'浮球',model:'其他浮球线径0.55'}),null);
 assert.equal(capacitorValueOf({model:'规格目录',naming:{ruleId:'capacitor',spec:{capacitanceUf:12}}}),12);
});
test('规范电缆成本仍为每米价乘长度加配件，面积不另乘，米数单独用于库存',()=>{
 const {calculateCompleteCableCost}=require('../api/services/costEngine.cjs');
 const result=calculateCompleteCableCost({cableWire:'0.55',cableLength:8,cableAccessoryType:'xinjie'},{partsCatalog:[part(1)],getSetting:key=>key==='cable_accessories'?JSON.stringify({xinjie:{name:'新界式',fee:3.4}}):undefined});
 assert.equal(result.snapshotPrice,15);assert.equal(result.inventoryQty,8);assert.equal(result.model,'目录名称1');
});
