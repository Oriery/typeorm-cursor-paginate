# Release notes

## 3.0.0 — prepared, not yet published

This major release replaces v2 cursor and query behavior. Read [MIGRATION.md](MIGRATION.md) before upgrading; discard v2 cursors and restart cached pagination.

- Pagination clones the caller's query, preserves authorization predicates and parameters, and rejects incompatible ordering, limits, projections and query shapes before SQL.
- Ordering includes every root primary-key component, supports mixed directions and explicit NULL placement, and traverses ties deterministically in both directions.
- Versioned, bounded cursors validate database representations and expose stable `PaginationInputError` codes. PostgreSQL timestamp boundaries retain microseconds before entity hydration; bigint and numeric boundaries retain exact text.
- Entity pages select distinct root keys and hydrate complete joined collections in bounded root batches. Typed raw pages support root rows with to-one joins; counts measure matching roots.
- Availability flags check both sides by default, including deleted boundaries. Nonempty pages retain both cursors. `noOppositePageCheck` explicitly skips the opposite probe and returns `null` for that unchecked flag; total counting remains independent.
- CommonJS and native ESM entry points share one implementation and constructor identity. Conditional declarations support TypeScript NodeNext, Node16, legacy node and bundler resolution. Deep implementation imports are blocked.
- Exported declarations from CommonJS consumers using TypeScript's default resolution can name public result types, including inferred bases from generic class factories. Metadata-backed mapped-one entity joins and exact composite joined keys with a single text/enum component are supported without weakening raw-row or ambiguous-identity restrictions.
- Selected joined identities reject arrays, JSON and other unsupported storage families before SQL. Unsafe SQLite integer keys fail explicitly before returning hydrated results, preventing silent loss of related rows through driver rounding and ORM grouping.
- Runtime support is Node 22.13+ within 22.x, 24.11+ within 24.x, and 26+ within 26.x, with TypeORM `^0.3.21 || ^1.0.0` and TypeScript consumers 5.7.3+ within 5.x/6.x. Node 22 has release-validation coverage but is not in ongoing CI.

### Timestamp correction

The generic reproduction in `src/postgres-regressions.test.ts` stores six-digit PostgreSQL `timestamp` and `timestamptz` values, including a DST transition, equal timestamps and differing process/session timezones, then traverses all identities forward and backward.
The cursor now selects the database boundary before JavaScript `Date` hydration loses microseconds.
`timestamptz` boundaries are formatted in UTC explicitly; `timestamp without time zone` boundaries retain their calendar values without timezone conversion.
Ordering and comparison continue to use the native database column.
Hydrated public `Date` fields can still have millisecond precision, so clients must keep the opaque returned cursor instead of reconstructing one from a field.

The earlier text-column workaround is unnecessary for the supported PostgreSQL types.
Formatting session-local `now()` with a literal `Z` is not a valid UTC conversion; applications migrating historical values must establish their original timezone separately.
This package does not reinterpret or migrate application data.

### Release verification

Run `npm ci` and `npm run check` before publication.
The suite checks SQLite and real PostgreSQL, lint, formatting, types, reproducible tarballs, the production file allowlist, installed CJS/ESM consumers and executable README examples.
The MIT license is retained in the distribution; no development dependencies, sources, tests or source maps are shipped.
Known query-shape, precision and consistency limits are in the [core contract](docs/core-contract.md).

Publish only the verified artifact with an authorized npm account:

```sh
PACKAGE_OUTPUT_DIR=artifacts npm run test:package
npm whoami
npm publish artifacts/typeorm-cursor-paginate-3.0.0.tgz --access public --tag latest
```

After publication, download the registry artifact to a fresh directory and run the same installed-consumer checks against it:

```sh
mkdir -p /tmp/paginator-registry-v3
npm pack typeorm-cursor-paginate@3.0.0 --pack-destination /tmp/paginator-registry-v3
PACKAGE_TARBALL=/tmp/paginator-registry-v3/typeorm-cursor-paginate-3.0.0.tgz npm run test:package
npm view typeorm-cursor-paginate@3.0.0 version dist.integrity
```

Compare the downloaded tarball hash with the verified local artifact before recording the release as published and tagging its commit.
