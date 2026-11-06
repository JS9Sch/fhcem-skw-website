// Hash an attendance admin code for the Worker secret ATTENDANCE_ADMIN_CODE_HASH.
// Reads the code from stdin and prints only the hash, so it can be piped straight
// into `npx wrangler secret put ATTENDANCE_ADMIN_CODE_HASH` without being shown.
import { normalizeCode } from '../src/attendance-core.js';
import { newCodeHash } from '../src/unit-access.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const code = normalizeCode(input.trim());
if (!code) { console.error('Code must be 8–32 letters or digits (spaces and hyphens ignored).'); process.exit(1); }
const { salt, hash } = await newCodeHash(code);
process.stdout.write(salt + ':' + hash);
