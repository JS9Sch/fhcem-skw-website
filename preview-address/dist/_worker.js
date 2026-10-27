// Service binding preserves the request URL, origin and cookies on the public address.
export default {
  async fetch(request, env) {
    return env.PREVIEW.fetch(request);
  }
};
