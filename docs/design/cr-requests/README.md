# docs/design/cr-requests/ — contract change requests (after the M0 freeze)

One file per WP: `<WP-id>.md` (e.g. `WP-02.md`). Append requests; never edit `packages/core/**` or another owner's
contract yourself. The architect reviews the batch weekly (label `contract-change`, answer within 48 h), records
each decision in `packages/core/CR-LEDGER.md` (§3 onwards) and applies accepted changes.

Template (one block per request):

```md
## <short title>
- contract: `packages/<pkg>/src/contract.ts` (or `packages/core/src/{domain,api}.ts`) — `<TypeOrFunction>`
- change: <exact shape you need (TS snippet)>
- why: <what breaks or is impossible without it; spec section>
- workaround in place: `// CR-PENDING(<WP-id>)` at <file:line> (remove when applied)
- urgency: blocks <acceptance test / milestone> | nice to have
```

These files are proposals, so `scripts/check-cr-ledger.ts` does not scan this directory.
