// Loopback replay server for capturing real recipe CLI output in videos.
//
//   node replay_server.mjs scenario.json [port]
//
// scenario.json: { "routes": [ { "method": "GET", "path": "^/api/search/filters$",
//   "queryHas": "datasources",            // optional: match only if this query param is present
//   "queryLacks": "datasources",          // optional: match only if absent
//   "responses": [ {json}, {json}, ... ], // served in order; the last one repeats
//   "sse": [ {event}, ... ], "sseDelayMs": 40,   // or stream these as text/event-stream
//   "status": 200 } ] }
//
// Every request is logged to stderr so the capture can prove which calls the CLI made.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const [, , scenarioPath, portArg] = process.argv;
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const counters = new Map();

function match(req, url) {
  return scenario.routes.findIndex((r) => {
    if (r.method && r.method !== req.method) return false;
    if (!new RegExp(r.path).test(url.pathname)) return false;
    if (r.queryHas && !url.searchParams.has(r.queryHas)) return false;
    if (r.queryLacks && url.searchParams.has(r.queryLacks)) return false;
    return true;
  });
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const i = match(req, url);
    console.error(`${req.method} ${url.pathname}${url.search} -> ${i < 0 ? 404 : `route ${i}`}${body ? `  body=${body.slice(0, 400)}` : ''}`);
    if (i < 0) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: `unexpected ${req.method} ${url.pathname}` }));
    }
    const route = scenario.routes[i];
    const n = counters.get(i) ?? 0;
    counters.set(i, n + 1);
    // "sseSequence": one event list per request (last repeats); "sse": same list every time.
    const events = route.sseSequence ? route.sseSequence[Math.min(n, route.sseSequence.length - 1)] : route.sse;
    if (events) {
      res.writeHead(route.status ?? 200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const ev of events) {
        const lines = [];
        if (ev.event) lines.push(`event: ${ev.event}`);
        lines.push(`data: ${typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data)}`);
        res.write(lines.join('\n') + '\n\n');
        await new Promise((r) => setTimeout(r, route.sseDelayMs ?? 30));
      }
      return res.end();
    }
    const payload = route.responses[Math.min(n, route.responses.length - 1)];
    res.writeHead(route.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

server.listen(Number(portArg || 8787), '127.0.0.1', () => console.error(`replay listening on ${server.address().port}`));
