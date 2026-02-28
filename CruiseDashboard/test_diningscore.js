const fs = require('fs');
const code = fs.readFileSync('wwwroot/js/app.js', 'utf8');
// Strip out DOM stuff to just test getDynamicDiningScore
const funcCode = code.match(/function getDynamicDiningScore[\s\S]*?return 0;\r?\n}/)[0];
eval(funcCode);
console.log('Result:', getDynamicDiningScore({ cruiseLine: 'Disney', nights: 7, packageDiningScore: 90, mainDiningScore: 70 }, 'package'));
console.log('Done!');
