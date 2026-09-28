# Frontend Bundle Size Budget

The frontend CI build checks every JavaScript and CSS asset emitted in
`dist/assets` after gzip compression. Each asset has a maximum budget of
500 KiB (512,000 bytes). The check fails with the asset name and measured size
when any asset exceeds its budget.

To adjust the limits, edit `bundle-size-budget.json`. Add another budget entry
with a different file extension and `maxGzipBytes` value when a new asset type
needs coverage. The CI workflow runs `npm run build` followed by
`npm run check:bundle-size` in the frontend job.