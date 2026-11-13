import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Expected a release version');
const name=`emulsion-plugin-v${version}.zip`;
mkdirSync(path.join(root,'downloads'),{recursive:true});
copyFileSync(path.join(root,'dist/emulsion-plugin.zip'),path.join(root,'downloads',name));
const files=[name,'../Emulsion.html'];
writeFileSync(path.join(root,'downloads/SHA256SUMS'),files.map(file=>
  createHash('sha256').update(readFileSync(path.join(root,'downloads',file))).digest('hex')+'  '+file+'\n').join(''));
process.stdout.write(JSON.stringify({version,archive:`downloads/${name}`})+'\n');
