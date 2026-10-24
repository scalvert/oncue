# One search call

**Build:** `oncue render search-api`
**Attaches to:** `/api/search` (video.json `related.doc`)

| Scene | Visual | Real or illustrative |
|---|---|---|
| s1 | Title card | Stylized |
| s2 | Terminal: the request and its response | **Real** output (`capture/search.jq.txt`) |
| s3 | Exchange: request and response, top result highlighted | **Real** (`capture/search.json`, trimmed with `...` lines, never edited) |
| s4 | End card | Stylized |

## Claims

- "about forty milliseconds": `took_ms` in `capture/search.json`.
- Result fields (title, source, score): `capture/search.json`.

## Captures

`capture/search.json` is curl's output against the replay server serving `capture/scenario.json`:

```bash
oncue capture serve capture/scenario.json 8799 2> capture/requests.log &
curl -s -X POST http://127.0.0.1:8799/v1/search -H "Content-Type: application/json" \
  -d '{"query": "refund policy"}' > capture/search.json
jq . capture/search.json > capture/search.jq.txt
```

Acme and its data are fictional. Nothing needed redacting.
