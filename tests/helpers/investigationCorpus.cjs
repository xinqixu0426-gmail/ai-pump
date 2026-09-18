'use strict';
function cases(){
 const rows=[
 ['客户「客户-1」有哪些订单？','customer.orders','客户-1'],
 ['帮我看客户「客户-1」最近10个订单','customer.orders','客户-1',10],
 ['订单「ORD-1」属于哪个客户？','order.customer','ORD-1'],
 ['订单「ORD-1」对应的明细有哪些？','order.lines','ORD-1'],
 ['配方「配方-1」用了哪些零件？','recipe.parts','配方-1'],
 ['零件「零件-1」出现在哪些配方？','part.recipes','零件-1'],
 ['列出客户「客户-1」的订单','customer.orders','客户-1'],
 ['查询零件「零件-1」的配方引用','part.recipes','零件-1'],
 ['哪些零件库存不足？','parts.stock',null,null,'attention'],
 ['列出库存不超过5的零件','parts.stock',null,null,'attention'],
 ['有哪些零件已经没库存了？','parts.stock',null,null,'out'],
 ['库存小于等于0的零件有哪些？','parts.stock',null,null,'out'],
 ['哪些零件的库存大于0但不超过5？','parts.stock',null,null,'low'],
 ['列出库存大于5的零件','parts.stock',null,null,'ok'],
 ['先看10个库存不足的零件','parts.stock',null,10,'attention'],
 ['给我列出10个没有库存的零件','parts.stock',null,10,'out'],
 ['零件「零件-1」的库存和单价是多少？','part.facts','零件-1'],
 ['看看零件「零件-1」现在的库存以及目录价格','part.facts','零件-1'],
 ['零件「零件-2」还剩多少，单价多少？','part.facts','零件-2'],
 ['查一下零件「零件-2」的当前库存和目录单价','part.facts','零件-2'],
 ['零件「零件-3」现在的价格与库存情况是什么？','part.facts','零件-3'],
 ['想了解零件「零件-3」的库存数量及单价','part.facts','零件-3'],
 ['告诉我零件「零件-1」的目录单价，并列出其库存数量','part.facts','零件-1'],
 ['同时查询零件「零件-2」当前单价和库存','part.facts','零件-2'],
 ];
 const data=rows.map(([question,relation,identity,topN,stockStatus],i)=>({id:'M-'+String(i+1).padStart(2,'0'),question,relation,identity,pageSize:topN||20,...(stockStatus?{stockStatus}:{})}));
 for(const [question,relation,operation]of [['继续','customer.orders','continue'],['下一页','part.recipes','continue'],['再看后20条','parts.stock','continue'],
  ['看看第1个','customer.orders','ordinal'],['看第2个','recipe.parts','ordinal'],['第1个详情','parts.stock','ordinal']]){
  data.push({id:'M-'+String(data.length+1).padStart(2,'0'),question,relation,operation,prior:{version:1,relation,...(relation==='parts.stock'?{stockStatus:'attention'}:{rootId:1}),pageSize:20}});
 }
 return data;
}
function fixture(){
 const db=require('./collectionFixture.cjs').collectionFixture();
 db.prepare('UPDATE orders SET customer_id=1').run();
 db.prepare('UPDATE parts SET stock=2,price=3').run();
 db.prepare('UPDATE parts SET stock=0 WHERE id<=10').run();
 db.prepare('UPDATE recipes SET parts_json=?').run(JSON.stringify([{model:'零件-1'},{model:'零件-2'}]));
 return db;
}
module.exports={cases,fixture};
