# Issue 689 Cache Proof

Command:

```text
node scratch/issue-689-cache-proof.mjs
```

Output:

```json
{
  "before": {
    "listInvalidated": true,
    "detailInvalidated": false,
    "versionsInvalidated": false
  },
  "after": {
    "listInvalidated": true,
    "detailInvalidated": true,
    "versionsInvalidated": true
  }
}
```

The before state simulates the previous Prof Mari `character_updated` event handler:
it invalidated the character list, but left the cached character detail query fresh.
Opening the card detail view could therefore reuse stale data for up to the configured
five-minute stale window.

The after state simulates the patched handler, which invalidates the list, the updated
character detail query, and that character's version history query.
