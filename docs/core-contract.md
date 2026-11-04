# v3 core contract

This document describes the v3 release candidate. The [README](../README.md) defines the supported runtimes and package entry points; [the work plan](https://github.com/Oriery/typeorm-cursor-paginate/blob/main/todo.md) records acceptance evidence. Stable npm publication is a separate release stage.

## Supported queries and ownership

`CursorPaginator(Entity, options)` validates that `Entity` matches the query's root metadata. Pagination clones the caller's builder before adding selections, predicates, parameters, ordering, or limits. Reusing that builder for forward/backward navigation preserves its SQL and parameters.

| Query shape                                                        | Entity mode: `paginate`                                                                     | Raw mode: `paginateRaw<TRaw>`                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Root entity and filtered queries                                   | Supported                                                                                   | Supported                                            |
| Relation joins to one root-related row                             | Supported                                                                                   | Supported                                            |
| To-many relation joins                                             | Supported; root limits preserve the selected joined collections                             | Rejected; raw mode promises one SQL row per root     |
| Root column ordering                                               | Supported, including embedded property paths and renamed database columns                   | Same ordering contract                               |
| Partial direct-column selections                                   | Supported; select at least one root column                                                  | Supported with the caller's declared SQL output type |
| Custom SQL output aliases                                          | Use raw mode                                                                                | Supported when output aliases are unambiguous        |
| Computed expressions or aggregate projections; `GROUP BY`/`HAVING` | Rejected                                                                                    | Rejected                                             |
| Existing ordering, `take`, `skip`, `limit`, or `offset`            | Rejected, including entity metadata default ordering and explicitly configured zero offsets | Rejected                                             |
| Caller `DISTINCT`/`DISTINCT ON`, CTEs, additional `FROM` sources   | Rejected                                                                                    | Rejected                                             |
| Manual/subquery joins or `joinAndMap` joins                        | Rejected; supported joins must use relation metadata                                        | Rejected                                             |
| Locks, query caching, relation ID/count loaders                    | Rejected                                                                                    | Rejected                                             |

SQLite (`better-sqlite3` and `sqlite` driver types) and PostgreSQL are the accepted drivers. The integration fixtures exercise `better-sqlite3` and PostgreSQL; the separate `sqlite3` adapter is not independently exercised by those fixtures. Other drivers fail explicitly.

Entity hydration imposes an additional identity constraint on selected joined entities: temporal primary keys are rejected, and composite primary keys may contain only integer, bigint, boolean, or UUID columns. Other composite joined identities can collide inside TypeORM's entity grouping. Filtering-only joins are not subject to that hydration restriction, and raw to-one joins do not hydrate entities. Composite text keys on the root itself are supported through the batching fallback described below.

Use entity property paths, such as `profile.label`, rather than database names or arbitrary SQL in `orderBy`. Metadata resolves renamed database columns. Relation paths, virtual/computed properties, unknown keys, and duplicate order keys are rejected. A foreign-key value exposed as an ordinary root column can be ordered by its root property path.

Direct predicate subqueries remain supported when their parameters are attached to the query builder. Cursor parameters receive unused names, including when caller predicates, joins, or subqueries already use paginator-like names. Existing predicates are grouped before adding the cursor condition: `(A OR B) AND cursor`. Values remain bound parameters; identifiers come from metadata. Nested object WHERE construction is unnecessary for these guarantees. CTEs are rejected because their separate parameter and query-composition rules are outside this contract.

The paginator owns ordering and limits. Combining a preconfigured limit or order with keyset pagination was rejected because it changes the traversal boundary or applies two independent pagination schemes. The library also declines to infer the cardinality of arbitrary joins or reinterpret aggregates as entities.

## Ordering and uniqueness

The order tuple must explicitly include **every root primary-key column**, including composite or embedded primary keys. Other fields may precede or follow them. Unique indexes are not used as an alternative proof, and the paginator never silently appends a key. This policy makes a total order verifiable from metadata without changing caller-specified ordering.

Values follow TypeORM's `FindOptionsOrderValue` forms:

- `"ASC"`, `"asc"`, or `1` means ascending.
- `"DESC"`, `"desc"`, or `-1` means descending.
- Objects accept optional string `direction` and `nulls: "FIRST" | "first" | "LAST" | "last"`. An omitted direction means ascending; `{}` and `{ nulls: "first" }` are valid.
- Omitted NULL placement means `LAST`, independently of direction and database defaults.

Unknown values, explicit null options, and duplicate keys across array entries fail. Ordering is lexicographic, with SQL `IS NULL` handling for nullable boundaries. Backward queries reverse both direction and NULL placement, then return nodes in the original requested order. Tests cover ties, multiple nullable fields, mixed directions, and complete traversals in both directions.

## Database values and precision

Cursors contain **database boundary representations**, not hydrated entity properties. This matters when TypeORM applies a column transformer or a driver converts a timestamp to a JavaScript `Date`. The paginator selects exact boundary values independently and binds those database values directly on the next request; it does not apply `preparePersistentValue` a second time.

| Storage family                         | Cursor representation and limits                                                                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integer columns                        | Safe integer JavaScript numbers. PostgreSQL smallint/int2 and integer/int4 additionally enforce their database ranges. SQLite integers outside the safe number range are unsupported.                                                                                                              |
| PostgreSQL bigint/int8                 | Canonical signed decimal strings within the signed 64-bit range; no leading zeroes except `"0"`, no `"-0"`, no exponent, number, or JavaScript bigint payload.                                                                                                                                     |
| PostgreSQL numeric/decimal             | Exact ordinary decimal strings, without exponent notation or nonfinite values. Declared precision/scale is enforced. Constrained columns require `0 <= scale <= precision`; negative scale and scale greater than precision are unsupported. Unconstrained numeric is allowed within token bounds. |
| SQLite numeric/decimal                 | Rejected for ordering because SQLite numeric affinity does not establish exact decimal semantics. Use integer units or an appropriate supported storage type.                                                                                                                                      |
| Floating-point columns                 | Finite JavaScript numbers using the stored floating-point semantics. PostgreSQL real/float4 enforces its finite storage range and rejects nonzero values that underflow to zero; SQLite REAL uses its double-precision range. NaN and infinities are unsupported.                                  |
| Text and related string columns        | Valid UTF-8 round-tripping strings without NUL. UUID syntax and declared enum membership are checked where applicable.                                                                                                                                                                             |
| Boolean columns                        | PostgreSQL booleans; SQLite database values `0` and `1`. These are storage representations, not custom transformed entity values.                                                                                                                                                                  |
| PostgreSQL timestamp without time zone | Calendar date/time text with up to six fractional digits; generated boundaries always retain six. No timezone conversion is applied.                                                                                                                                                               |
| PostgreSQL timestamptz                 | UTC date/time text ending in `Z`, retaining six fractional digits in generated boundaries. Ordering uses the native timestamp column.                                                                                                                                                              |
| Date                                   | Calendar text `YYYY-MM-DD`.                                                                                                                                                                                                                                                                        |
| SQLite datetime                        | TypeORM's fixed-width `YYYY-MM-DD HH:mm:ss.SSS` text only. Arbitrary datetime layouts, timezone suffixes, and sub-millisecond storage are unsupported.                                                                                                                                             |
| NULL                                   | Allowed only for nullable ordering columns.                                                                                                                                                                                                                                                        |

Temporal values must be valid calendar values in years 1–9999, with ordinary hours/minutes/seconds. Infinite dates/timestamps, BC dates, and out-of-range years are rejected rather than encoded as NULL or another era. Temporal primary keys are rejected because ordinary TypeORM hydration can lose identity precision. Arrays, JSON, binary, spatial, and other unlisted storage types are unsupported as ordering keys. Non-ordering columns may still use the ordinary TypeORM hydration behavior.

PostgreSQL timestamp extraction occurs in SQL before the driver can discard microseconds. Timestamptz boundaries use UTC explicitly, so the process timezone and database session timezone do not redefine the boundary. Timestamp-without-time-zone values retain their wall-clock meaning. The public entity or raw field still follows its normal driver representation and can be less precise than the private cursor value; do not reconstruct a cursor from that field.

Converting hydrated `Date` values back to JSON was rejected as a precision fix: lost microseconds cannot be recovered. Likewise, sorting bigint/numeric text lexically would be incorrect; boundary text is selected separately while ordering and comparisons use the native database columns.

## Cursor format and compatibility

A token is `v3:` followed by the configured codec's representation of a complete envelope:

```typescript
interface CursorEnvelope {
  version: 3;
  direction: "next" | "prev";
  order: {
    key: string;
    direction: "ASC" | "DESC";
    nulls: "FIRST" | "LAST";
  }[];
  values: (string | number | boolean | null)[];
}
```

The default codec is canonical, unpadded Base64URL containing UTF-8 JSON. Tokens are limited to **16,384 JavaScript string characters including the `v3:` prefix**. Malformed encoding/UTF-8/JSON, wrong envelope keys, sparse or malformed arrays from custom parsers, incompatible normalized ordering, invalid values, and oversized tokens fail validation. Version checks reject v2 `next:`/`prev:` tokens and other versions with `UNSUPPORTED_CURSOR_VERSION`; restart without a cursor. There is no legacy compatibility reader.

Order names, directions, and NULL placement are bound into the envelope. Filters, authorization context, entity identity, and database identity are not. Changing any of those requires the caller to reset pagination even if a token remains structurally valid. The same cursor may be used by entity and raw mode for the same supported root query and ordering.

Base64 is neither encryption nor authentication. Clients may inspect or modify cursor values. Always apply authorization filters to every page query; possession of a cursor grants no access. A codec may add authentication or encryption, but it must preserve the complete envelope and the paginator's validation still applies.

## Custom cursor encoding

The option is `cursorTransformer`, and `CursorTransformer` is no longer generic over an entity. Its parser returns `unknown`; its serializer receives `CursorEnvelope`. This JSON codec is equivalent to the provided `JsonTransformer`:

```typescript
import {
  CursorPaginator,
  type CursorEnvelope,
  type CursorTransformer,
} from "typeorm-cursor-paginate";

const jsonCodec: CursorTransformer = {
  parse(text: string): unknown {
    return JSON.parse(text) as unknown;
  },
  stringify(cursor: CursorEnvelope): string {
    return JSON.stringify(cursor);
  },
};

const paginator = new CursorPaginator(User, {
  orderBy: { id: "ASC" },
  cursorTransformer: jsonCodec,
});
```

`User` is the entity from the [README example](../README.md#entity-pages). A codec must synchronously return a nonempty string, round-trip the complete envelope without changing values or order, and avoid mutating the supplied envelope. It handles only the body after `v3:`. It must not hydrate dates, coerce large numbers, or apply entity column transformers. Parser failures and decoded input are validated through the same stable error contract as the default codec. The token length bound applies to custom codecs too.

## Results, projections, and counts

`Paginated<TNode>` contains `nodes`, `totalCount`, `hasPrevPage`, `hasNextPage`, `prevPageCursor`, and `nextPageCursor`. Its availability fields remain booleans by default. `Paginated<TNode, boolean | null>` represents results whose opposite-direction availability can be unchecked.

Entity mode first selects distinct root ordering tuples, bounded by `limit + 1` when a limit is supplied. It then hydrates only the retained roots through the original joins. Hydration uses batches of at most 200 roots and budgets 800 primary-key parameter values per batch, so large or unlimited pages do not create a single enormous OR expression. Limiting the root-key query avoids truncating an entity's joined collections. It does not bound the number of related rows those roots can contain.

Partial entity selections must include at least one root column. Required sort fields and primary keys may be omitted. Private selections supply cursor and hydration identity values, then omitted keys are removed, including empty embedded containers introduced only for private keys. Public omitted fields stay absent. TypeORM's entity return type does not make omitted properties present at runtime.

Raw mode returns the caller's SQL projection with its aliases and driver values, not a hydrated `TEntity`. Use `paginateRaw<TRaw>` or standalone `paginateRaw<TRaw, TEntity>` to state that projection; omitting either API's output type yields `Record<string, unknown>`. Raw mode limits SQL rows directly because its supported to-one joins preserve one row per root. To-many raw joins are rejected instead of returning an arbitrary child row or claiming root limits over a multiplying result.

For both modes, `totalCount` is the number of matching root records before applying the cursor, independent of direction and page limit. Joined multiplicity does not increase it. Composite root identities are counted as distinct SQL tuples, not concatenated strings. `noTotalCount` defaults to `false`; setting it to `true` yields `null` and suppresses the count read only.

## Page availability and empty pages

By default, for an unchanged matching dataset, flags report actual availability on both sides of the returned page. The requested direction uses one extra root as lookahead. A request containing a cursor with `noOppositePageCheck` omitted or `false` uses a separate opposite-direction existence probe against the first returned boundary for forward navigation or last returned boundary for backward navigation. Supplying a cursor alone does not prove that the page it came from still exists.

`noOppositePageCheck` defaults to `false`, following the opt-out convention of `noTotalCount`. Set `noOppositePageCheck: true` to skip that probe. The requested-direction flag still comes from lookahead, while the opposite flag is `null`, meaning unchecked. A supplied cursor is never treated as proof of availability, and skipping a probe never fabricates a `true` or `false` answer. This option is independent of `noTotalCount`: even a computed total does not substitute for the skipped availability check.

| Request with `noOppositePageCheck: true` | `hasPrevPage`        | `hasNextPage`        |
| ---------------------------------------- | -------------------- | -------------------- |
| No input cursor                          | `false`              | Known from lookahead |
| Forward cursor                           | `null`               | Known from lookahead |
| Backward cursor                          | Known from lookahead | `null`               |

The instance and standalone entity/raw APIs have overloads preserving `Paginated<TNode>` for default or literal-`false` calls. Literal `true`, a dynamic boolean, or a variable typed as the broad `CursorPaginatorPaginateParams`/`PaginateOptions` returns `Paginated<TNode, boolean | null>`. Both properties are nullable in that type because the cursor's direction is encoded at runtime, although at least the requested-direction flag is always known. Preserve `false` as a literal in reusable options when a statically checked result is required. An opted-out call without a cursor also has known runtime flags, but retains the broader static result type.

TypeScript can report TS7022 when a loop feeds `page.nextPageCursor` back into the input cursor and tries to infer the overloaded call's result at the same time. Break that inference cycle with an explicit page annotation:

```typescript
let cursor: string | null = null;
for (;;) {
  const page: Paginated<User> = await paginator.paginate(query, {
    limit: 20,
    pageCursor: cursor,
  });
  if (!page.hasNextPage) break;
  cursor = page.nextPageCursor;
}
```

Import `Paginated` as a type from the package entry. For a loop that opts out or uses dynamic options, annotate `Paginated<User, boolean | null>` instead. The overloads retain default boolean guarantees; a single broadly nullable signature would unnecessarily widen every caller's result.

Every nonempty page retains both boundary cursors, even when a corresponding flag is false or null. This permits refreshes and navigation after later changes. Boundary rows may have been deleted; cursor comparisons use their stored values and do not require those rows to remain present.

An empty page has `nodes: []` and both cursors `null`. With no input cursor, both flags are false. With an input cursor, the requested-direction flag is false and an **inclusive** opposite-direction probe uses the supplied tuple. For example, paging past the final row can return an empty page with `hasPrevPage: true` even if the only surviving row is exactly the supplied boundary. After all matching rows are deleted, both checked flags are false. With `noOppositePageCheck: true`, an empty cursor page instead has `false` in the requested direction and `null` in the opposite direction; both cursors remain null. Empty cursorless pages always have both flags false.

## Read consistency and costs

Key selection, entity hydration, availability probing, and counting are separate reads. The paginator does not start a transaction or promise a snapshot across them. Concurrent inserts, deletes, or ordering-field updates can change the returned page, flags, and count between reads. A root deleted before hydration can leave a short page; a count may reflect a later dataset than the page. For a consistent snapshot, supply a query bound to a caller-managed transaction with appropriate database isolation. A transaction alone is not a cross-request snapshot guarantee.

For entity pages fitting one hydration batch, the costs below exclude TypeORM listeners/subscribers and database work performed by application code. The opposite check is enabled unless explicitly disabled:

| Page operation                               | Database reads                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Nonempty entity page without an input cursor | Root-key read + hydration: 2                                                                         |
| Nonempty entity page with an input cursor    | Root-key read + hydration + opposite probe: 3; **2** with `noOppositePageCheck: true`                |
| Raw page without an input cursor             | Page read: 1                                                                                         |
| Raw page with an input cursor                | Page read + opposite probe: 2; **1** with `noOppositePageCheck: true`                                |
| Empty entity page                            | No hydration; key read plus an opposite probe only when a cursor was provided and checks are enabled |
| Total count enabled                          | Add 1 to the applicable row                                                                          |

Larger entity pages add one hydration read for each additional batch. With `K` root primary-key columns, the normal batch size is `min(200, floor(800 / K))` roots, with a minimum of one. An exceptional fallback isolates roots whose composite keys would collide in TypeORM's delimiter-based grouping, such as `("a_b", "c")` and `("a", "b_c")`. When that ambiguity occurs, separate root hydration reads prevent silent entity merging; hydration can cost one read per retained root. This exception concerns ORM grouping, not cursor identity or SQL count uniqueness.

Availability probes use `SELECT 1 ... LIMIT 1`, not full counts. Their output is bounded, but their work is not guaranteed constant: filters, joins, ordering expressions, selectivity, and indexes determine how much the database must scan. The key query may also sort or deduplicate joined candidates. Create indexes appropriate to the query's authorization/filter predicates and ordering, and inspect plans for real workloads. Omitting `limit` deliberately removes the key-result bound and can require substantial memory and hydration work.

## Errors and validation

The public `PaginationInputError` has a stable `name` and `code`; message wording is descriptive rather than a parsing contract.

| Code                         | Meaning                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPTION`             | The removed `transformer` option, a malformed `cursorTransformer`, or a `noOppositePageCheck` value other than boolean/undefined was supplied.  |
| `INVALID_LIMIT`              | Limit is not an omitted value or a positive finite safe integer.                                                                                |
| `INVALID_ORDER`              | Empty, duplicate, unknown, or invalid ordering; required primary-key components are missing.                                                    |
| `INVALID_CURSOR`             | Encoding, envelope, direction, ordering compatibility, or external boundary-value validation failed; also codec parsing/serialization failures. |
| `UNSUPPORTED_CURSOR_VERSION` | Legacy or unsupported token version; restart pagination.                                                                                        |
| `UNSUPPORTED_QUERY`          | Entity mismatch, unsupported driver/query shape, ambiguous projection, or hydration that cannot represent one entity per root.                  |
| `UNSUPPORTED_VALUE`          | Unsupported ordering storage type, unsupported value read from the database, or an output cursor that exceeds the bound.                        |

Constructor-level order errors are synchronous. Query metadata, limits, and external cursor input are checked before pagination SQL executes. Invalid stored values can only be discovered after reading them, and are rejected at boundary extraction. This contract does not turn unrelated SQL, connectivity, permission, or application-subscriber failures into pagination-input errors.

## Validation and measured costs

The suites use actual SQLite and PostgreSQL databases. Coverage includes complete forward/backward traversal, immutable caller builders, authorization parameter collisions, ungrouped OR predicates, mixed directions and NULLs, deleted boundaries and opposite pages, raw aliases, joined fan-out, partial projections, malformed inputs, composite identities, and count suppression. PostgreSQL fixtures include differing process/database timezones, a DST boundary, equal timestamps, milliseconds/microseconds, exact numeric/bigint values, and non-idempotent column transformers.

In the PostgreSQL fixture with 10,007 matching roots and page limit 2, the root-key query returned 3 tuples, hydration of the 2 retained roots returned 4 joined rows, and the opposite availability probe returned 1 row using an index plan. This verifies the measured query behavior, not a constant bound on scanned rows or joined collections. The tests also measure actual read counts: `noTotalCount` removes COUNT SQL independently of availability, and `noOppositePageCheck: true` removes exactly one opposite probe on cursor requests while retaining requested-direction flags, projections, and cursors. SQLite and PostgreSQL tests cover the default and opted-out modes in both directions, including empty pages; compile-time assertions preserve default boolean flags and honest nullable/raw output types.

Run the commands in the [README](../README.md#development-and-validation). PostgreSQL requires `npm run test:postgres` or an explicitly configured test URL; the SQLite-only test run is not evidence for timestamp correctness. Validation results and release follow-ups are recorded in [the backlog](https://github.com/Oriery/typeorm-cursor-paginate/blob/main/todo.md).
