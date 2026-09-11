import { readFileSync } from 'node:fs';

const sourcePath=new URL('./apply-field-workflow-wave1.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');
const broken='src=mutate(src,replace);';
const fixed='mutate(src,replace);';
const count=source.split(broken).length-1;
if(count!==1) throw new Error(`Wave 1 runner repair expected 1 assignment, got ${count}`);
source=source.replace(broken,fixed);
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
