import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbiddenPath=/(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.wrangler|node_modules|evidence|audit[^/]*|imported-brethren|user-evidence|uploads)(\/|$)|\.(?:zip|har)$/i;
const secretPattern=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|fhcemskw\d{6,}/;
let failed=false;
for(const file of files){
 if(forbiddenPath.test(file)&&file!=='.dev.vars.example'){console.error('Disallowed tracked path:',file);failed=true;continue}
 if(secretPattern.test(readFileSync(file,'utf8'))){console.error('Possible secret in tracked file:',file);failed=true}
}
if(!files.length){console.error('No tracked files found. Stage the intended public files before checking.');process.exit(1)}
if(failed)process.exit(1);
console.log(`Checked ${files.length} tracked files: no forbidden private paths or common secret patterns. This is a guard, not a complete secret scanner.`);
