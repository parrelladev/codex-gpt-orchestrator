import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/vitest/vitest.mjs',import.meta.url)),'run','tests/chrome.integration.test.ts'],{stdio:'inherit',env:{...process.env,RUN_CHROME_TESTS:'1'},windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
