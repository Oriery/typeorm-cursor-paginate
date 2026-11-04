# Migration

## v2 to unreleased v3

v3 intentionally changes cursor format, validation, ordering guarantees, and raw-result behavior. The core changes below are implemented in source. Package exports, CJS/ESM consumer fixtures, supported Node versions, deep-import policy, and publication are still part of [section B](todo.md#b-public-api-and-distribution); this guide does not claim those release checks are complete.

### Restart existing pagination

Discard stored v2 cursors when moving to v3. Tokens beginning with `next:` or `prev:` are rejected with `PaginationInputError.code === "UNSUPPORTED_CURSOR_VERSION"`. Start a fresh page without `pageCursor`; there is no v2 compatibility reader.

v3 tokens start with `v3:` and encode a complete versioned envelope, including direction and normalized ordering. They reject changed ordering, malformed values, and oversized input. Reset pagination when filters, authorization scope, entity, or database change: those are not authenticated or bound into the token. See the [cursor contract](docs/core-contract.md#cursor-format-and-compatibility).

### Make the ordering explicit

Every root primary-key column must occur in `orderBy`, including each component of a composite key. Add any missing key yourself:

```typescript
// v2: uniqueness was the caller's unchecked responsibility.
const previous = { orderBy: { name: "ASC" as const } };

// v3: this User entity has a single primary key, id.
const current = { orderBy: { name: "ASC" as const, id: "ASC" as const } };
```

The paginator does not append keys or infer another unique tuple from a unique index. Duplicate keys, unknown property paths, and invalid direction values now fail. Database column names must be replaced with mapped root property paths where they differ; embedded paths are supported, relation/computed ordering is not.

NULLs now default to `LAST` for both ascending and descending directions. Specify `nulls: "FIRST"` to request the opposite behavior. Backward traversal reverses NULL placement together with direction and returns the original order.

### Prepare an unpaginated query

Remove caller ordering, `take`, `skip`, `limit`, and `offset`, including entity-level default ordering. Pagination rejects these configurations instead of combining them. It clones the builder, so successful or failing pagination calls leave its query state and parameters unchanged.

Review the [supported query table](docs/core-contract.md#supported-queries-and-ownership) before migrating grouped queries, aggregates, CTEs, custom joins, loaders, locking, or caching. These unsupported shapes now fail explicitly. The constructor's entity argument is retained and checked against root metadata.

`limit` is either omitted, meaning all remaining roots, or a positive finite safe integer. `null`, strings, zero, negative/fractional numbers, NaN, and Infinity are not accepted limits.

### Replace positional raw mode

Replace the old third boolean argument with a separate typed method. Both the class method and standalone function reject the removed positional raw argument before SQL, including JavaScript calls that bypass TypeScript checking:

```typescript
// v2:
// const page = await paginator.paginate(query, { limit: 20 }, true);

// v3, for query.select("user.id", "user_id"):
const page = await paginator.paginateRaw<{ user_id: number }>(query, {
  limit: 20,
});
```

The standalone counterpart is `paginateRaw<TRaw, TEntity>(Entity, query, options)`. Raw mode returns driver values and SQL aliases. It paginates root records and supports only to-one relation joins; to-many raw joins are rejected. Entity mode continues to support to-many joins and preserves the selected roots' complete joined collections, subject to the [joined entity identity restrictions](docs/core-contract.md#supported-queries-and-ownership). Counts measure matching roots in both modes.

Partial direct-column projections can omit ordering fields and primary keys. The paginator obtains private boundary values and removes private hydration keys from results. Entity projections must select at least one root column and cannot rename it with a custom SQL alias; use raw mode for custom output names.

### Update cursor transformers and value assumptions

Rename `transformer` to `cursorTransformer`. `CursorTransformer` no longer takes an entity type parameter. Change custom codecs to serialize the complete `CursorEnvelope`, return `unknown` from `parse`, and preserve database value representations. The old entity-shaped `Cursor<TEntity>` and `DirectionalCursor<TEntity>` types have been replaced by `CursorEnvelope`, `CursorValue`, and normalized order information.

The paginator validates custom decoded input too. Do not convert bigint/numeric strings to numbers, timestamp strings to `Date`, or apply a TypeORM column transformer in the codec. The [JSON codec contract](docs/core-contract.md#custom-cursor-encoding) shows the required shape. The `v3:` prefix and 16,384-character total bound are managed by the paginator.

PostgreSQL timestamp boundaries preserve database microseconds; public hydrated `Date` fields may still have millisecond precision. PostgreSQL bigint and numeric boundaries use exact text. SQLite integers must remain safely representable as JavaScript numbers, decimal/numeric ordering is rejected, and datetime ordering requires TypeORM's fixed millisecond text format. Temporal primary keys and other unsupported representations fail rather than silently lose precision. Review the full [value table](docs/core-contract.md#database-values-and-precision).

### Use the availability flags and stable errors

A supplied cursor no longer forces the opposite-direction flag to `true`. The paginator checks whether matching roots actually remain there, including after deletions. Nonempty pages retain both boundary cursors even when a flag is false. Empty pages have null cursors and use an inclusive opposite-direction check against the input boundary.

`noTotalCount: true` still gives `totalCount: null` and suppresses only counting. The separate `noOppositePageCheck` option defaults to `false`, like `noTotalCount`; setting it to `true` skips the opposite-direction probe and returns `null` for that unchecked flag. Requested-direction lookahead and cursorless flags remain known, and nonempty pages retain both cursors. On an empty cursor page, the requested flag is `false` and the unchecked opposite flag is `null`.

Default/literal-`false` calls keep `Paginated<TNode>` with boolean flags. Opted-out calls and dynamic or broadly typed options return `Paginated<TNode, boolean | null>`; preserve a literal `false` in reusable options when callers need a statically checked result. Distinguish `null` (unchecked) from `false` (no page); do not silently turn an unchecked value into a claimed availability result. In cursor-reassignment loops, TypeScript may require an explicit page-result annotation to avoid TS7022; the [availability contract](docs/core-contract.md#page-availability-and-empty-pages) includes an example. Calls can perform multiple reads and do not promise a consistent snapshot across concurrent writes. The [cost and consistency contract](docs/core-contract.md#read-consistency-and-costs) describes the additional reads and caller-managed transaction option.

Catch `PaginationInputError` and inspect its `code` for input failures. Do not match old generic error messages. External invalid input and unsupported query configuration fail before pagination SQL; unsupported stored boundary values are discovered when read.

### Source entry names and release-stage changes

The source entry exports named `paginate`, `paginateRaw`, `CursorPaginator`, `PaginationInputError`, `Base64Transformer`, and `JsonTransformer`, plus the intended option/result/cursor/error types as type-only exports. It retains `paginate` as the default source export. Named functions and the class are the documented primary API.

These source declarations do not resolve the separate v2 native-ESM packaging defects by themselves. A final release migration guide will also record verified runtime/module support, package entry points, and any deep-import removals after section B's build, pack, and consumer checks pass.

## v1 to v2

`CursorPagination` was renamed to `Paginated`: for example, `CursorPagination<User>` became `Paginated<User>`.
