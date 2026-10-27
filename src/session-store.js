import { DurableObject } from 'cloudflare:workers';

// One object per signed random session ID; there is no public HTTP endpoint.
export class PreviewSession extends DurableObject {
  async create(expires) {
    if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
      throw new Error('Invalid session expiry');
    }
    await this.ctx.storage.put('expires', expires);
    await this.ctx.storage.setAlarm(expires * 1000);
  }

  async active(expires) {
    return expires > Math.floor(Date.now() / 1000) &&
      await this.ctx.storage.get('expires') === expires;
  }

  async revoke() {
    // Await durable deletion before the Worker reports logout success.
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
