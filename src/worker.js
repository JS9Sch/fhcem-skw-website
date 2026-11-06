import memberScript from './member-app.txt';
import memberHTML from './member-index.txt';
import { respond } from './router.js';
export { PreviewSession } from './session-store.js';
export default { fetch: (request, env, ctx) => respond(request, env, { memberScript, memberHTML, waitUntil: ctx ? p => ctx.waitUntil(p) : undefined }) };
