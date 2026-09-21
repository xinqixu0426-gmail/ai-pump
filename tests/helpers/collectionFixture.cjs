'use strict';
const Database=require('better-sqlite3');
function collectionFixture(){
    const db=new Database(':memory:');require('../../api/database/migrations.cjs').runMigrations(db);
    db.transaction(()=>{for(let n=1;n<=63;n++){
        db.prepare('INSERT INTO orders(contract_no,customer_name,status,items_json) VALUES(?,?,?,?)').run('ORD-'+n,'客户甲',n%2?'待确认':'已关闭',JSON.stringify([{recipeName:'配方甲',qty:2,unitPrice:3}]));
        db.prepare('INSERT INTO customers(name) VALUES(?)').run('客户-'+n);
        db.prepare('INSERT INTO parts(model,category) VALUES(?,?)').run('零件-'+n,'壳体');
        db.prepare('INSERT INTO recipes(name,spec) VALUES(?,?)').run('配方-'+n,'规格甲');
        db.prepare('INSERT INTO coils(scheme_name,scheme_code,spec,material,sheets) VALUES(?,?,?,?,?)').run('线圈-'+n,'C-'+n,'规格-'+n,'钢带',20);
    }})();return db;
}
module.exports={collectionFixture};
