# Usage guide

Start with the [README quick start](../README.md#quick-start) for an entity, scoped query and complete forward/backward example. The examples below reuse its `User` entity and `paginator`; `query` is a builder scoped by `ownerId`, and `first` is the first page returned from that query.

## Contents

- [Use a standalone function](#use-a-standalone-function)
- [Choose ordering and NULL placement](#choose-ordering-and-null-placement)
- [Skip counts and opposite-page checks](#skip-counts-and-opposite-page-checks)
- [Return a raw projection](#return-a-raw-projection)
- [Handle invalid cursors](#handle-invalid-cursors)
- [Customize cursor encoding](#customize-cursor-encoding)
- [Imports and types](#imports-and-types)

## Use a standalone function

Use `paginate` when you do not need a reusable paginator instance. Its options combine constructor configuration with the options for this request:

```typescript
import { paginate } from "typeorm-cursor-paginate";

const page = await paginate(User, query, {
  orderBy: { name: "ASC", id: "DESC" },
  limit: 20,
  noTotalCount: true,
});
```

The entity argument must match the query's root entity. The standalone function clones the builder and follows the same ordering, validation and result contracts as the class.

## Choose ordering and NULL placement

Order values accept TypeORM's uppercase/lowercase strings, `1`/`-1`, and objects with `direction` and `nulls`. Columns are applied in the order you list them, and every root primary-key component must be included.

```typescript
const byName = new CursorPaginator(User, {
  orderBy: {
    name: { direction: "asc", nulls: "last" },
    id: "DESC",
  },
});
```

NULLs default to `LAST` for both directions. Backward traversal reverses the database order and NULL placement, then returns the page in the original display order. Specify the NULL order that suits your data and indexes, even for a non-null descending key.
Use entity property paths rather than database column names; dotted embedded paths work, while relation and computed ordering do not. See [ordering and uniqueness](core-contract.md#ordering-and-uniqueness).

## Skip counts and opposite-page checks

Set `noTotalCount: true` when the caller does not need a total. It skips only the count query; both availability flags remain checked by default.
If the caller only needs availability in the direction being fetched, it can skip the opposite probe too:

```typescript
const forward = await paginator.paginate(query, {
  limit: 20,
  pageCursor: first.nextPageCursor,
  noTotalCount: true,
  noOppositePageCheck: true,
});
// hasNextPage remains a boolean; hasPrevPage is null (unchecked).
```

For a backward cursor, `hasPrevPage` remains a boolean and `hasNextPage` becomes `null`. Treat `null` as unchecked, not as proof that no page exists. Cursorless pages keep both flags known without an extra probe; nonempty pages retain both boundary cursors in every mode.
Default calls return `Paginated<TNode>` with boolean flags. Opting out or passing a dynamic boolean returns `Paginated<TNode, boolean | null>`. The [availability contract](core-contract.md#page-availability-and-empty-pages) also covers empty pages and reusable option types.

## Return a raw projection

Use `paginateRaw` for direct SQL column selections with custom result aliases, and declare the actual row type:

```typescript
type UserRow = { user_id: number; display_name: string };

const rawQuery = query
  .clone()
  .select("user.id", "user_id")
  .addSelect("user.name", "display_name");

const page = await paginator.paginateRaw<UserRow>(rawQuery, {
  limit: 20,
});
```

Without `TRaw`, raw APIs return `Record<string, unknown>` rows. The standalone form is `paginateRaw<UserRow, User>(User, rawQuery, options)`.
Raw results use driver values; TypeORM column transformers apply to entity hydration only. Private selections supply cursor boundaries even when ordering fields are absent from the public projection.

Both modes paginate root records. Entity mode supports to-many relation joins and retains each selected root's complete joined collection, subject to the [joined identity restrictions](core-contract.md#supported-queries-and-ownership). Raw mode permits to-one relation joins and rejects to-many or mapped joins because they do not establish one SQL row per root.

## Handle invalid cursors

Catch the exported `PaginationInputError` and inspect its `code`, rather than parsing its message. `INVALID_CURSOR` identifies malformed or incompatible cursor input; `UNSUPPORTED_CURSOR_VERSION` identifies an obsolete or unsupported version. A consumer can clear its stored page chain and retry once without a cursor; surface a failed restart rather than retrying indefinitely.

Other codes can identify a programming error, such as missing primary keys in the ordering or an unsupported query shape. Keep those distinct from user-supplied cursor errors when adapting the library to an HTTP API. Unrelated database and connection errors remain their original errors. See the complete [error table](core-contract.md#errors-and-validation).

A cursor is opaque to the client, but Base64 is neither authentication nor encryption. Keep authorization predicates on every query. Restart pagination when filters, authorization scope, entity or database change; the token does not bind those contexts.
Keep the returned token rather than rebuilding it from a result field: PostgreSQL boundaries can retain microseconds or exact numeric values that a hydrated JavaScript value cannot represent. See [database values and precision](core-contract.md#database-values-and-precision).

## Customize cursor encoding

The default `Base64Transformer` encodes the validated envelope as Base64URL. Use the built-in `JsonTransformer` for JSON text, or provide an object implementing `CursorTransformer`:

```typescript
import type {
  CursorEnvelope,
  CursorTransformer,
} from "typeorm-cursor-paginate";

class JsonCursorTransformer implements CursorTransformer {
  parse(text: string): unknown {
    return JSON.parse(text) as unknown;
  }

  stringify(cursor: CursorEnvelope): string {
    return JSON.stringify(cursor);
  }
}
```

Pass `cursorTransformer: new JsonCursorTransformer()` beside `orderBy` in the constructor. The paginator owns the `v3:` prefix and the 16,384-character token bound, and validates the parser's `unknown` output before querying.
A codec must preserve the complete envelope and database values. Do not convert timestamp strings to `Date`, exact decimal strings to numbers, or apply entity column transformers. Codec failures produce `INVALID_CURSOR`. See the [cursor format](core-contract.md#cursor-format-and-compatibility) for its shape and compatibility rules.

## Imports and types

Import runtime values from the package root: `CursorPaginator`, `paginate`, `paginateRaw`, `PaginationInputError`, `Base64Transformer` and `JsonTransformer`.
The default ESM export aliases `paginate`; in CommonJS, `require("typeorm-cursor-paginate")` returns a namespace and `.default` is the function. Both formats share one implementation, including constructor identity for `instanceof` checks.

Use `import type` for `Paginated`, `PaginateOptions`, `CursorPaginatorParams`, `CursorPaginatorPaginateParams`, `Order`, `OrderBy`, `NormalizedOrder`, `CursorEnvelope`, `CursorValue`, `CursorTransformer` and `PaginationInputErrorCode`.
These names have no runtime values. The only additional public subpath is `typeorm-cursor-paginate/package.json`; deep `lib/...` and `src/...` imports are blocked.
