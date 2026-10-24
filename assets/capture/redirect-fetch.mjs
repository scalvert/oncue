// Node preload for video captures: send fetch() calls for the demo backend to the local
// replay server, so CLIs that require an HTTPS origin run unmodified.
//   NODE_OPTIONS="--import $(oncue capture fetch-preload)" REPLAY_FROM=https://api.example.com REPLAY_TO=http://127.0.0.1:8787
const from = process.env.REPLAY_FROM;
const to = process.env.REPLAY_TO;
if (from && to && typeof globalThis.fetch === 'function') {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(from)) {
      const rewritten = to + url.slice(from.length);
      return original(typeof input === 'string' || input instanceof URL ? rewritten : new Request(rewritten, input), init);
    }
    return original(input, init);
  };
}
