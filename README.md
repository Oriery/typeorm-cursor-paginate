# TypeORM Cursor Paginator

Cursor-based pagination for TypeORM queries on PostgreSQL and SQLite. Build feeds, infinite-scroll lists and paginated APIs by fetching records before or after an ordered boundary, rather than counting offsets or page numbers.

Each cursor carries its direction. Pass a returned `nextPageCursor` or `prevPageCursor` back through the same `pageCursor` option to move forward or backward.

- **Flexible ordering:** combine ascending and descending columns, choose NULL placement, and break ties with explicit primary keys.
- **Complete entity pages:** paginate root records while retaining their selected joined collections.
- **Precise boundaries:** preserve PostgreSQL timestamp microseconds and exact bigint/numeric values in cursors.
- **Useful page metadata:** get availability in both directions, reusable boundary cursors, and an optional total count.
- **TypeScript, CommonJS and ESM:** use typed entity or raw results from the same public API.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Page results and options](#page-results-and-options)
- [Compatibility](#compatibility)
- [How it compares](#how-it-compares)
- [More examples and reference](#more-examples-and-reference)
- [Contributing](#contributing)
- [License](#license)

## Installation

Install the package alongside TypeORM and your database driver. For PostgreSQL:

```sh
npm install typeorm-cursor-paginate@3 typeorm pg
```

For SQLite, use a `better-sqlite3` version compatible with your TypeORM version; see [compatibility](#compatibility).

**Upgrading from v2?** Read the [migration guide](MIGRATION.md) first. v3 changes cursor format and validates query shapes more strictly; discard old cursors and restart stored page chains.

## Quick start

Create a paginator with your entity and ordering, then pass it a scoped `SelectQueryBuilder`. Include **every primary-key column** in the ordering so equal values have a deterministic tie-breaker.

This example assumes an initialized TypeORM `DataSource` with `User` registered in its entities:

```typescript
import { Column, Entity, PrimaryColumn, type DataSource } from "typeorm";
import { CursorPaginator } from "typeorm-cursor-paginate";

@Entity()
class User {
  @PrimaryColumn("integer")
  id!: number;

  @Column("text")
  name!: string;

  @Column("integer")
  ownerId!: number;
}

const paginator = new CursorPaginator(User, {
  orderBy: { name: "ASC", id: "DESC" },
});

async function readUsers(
  dataSource: DataSource,
  ownerId: number,
  pageCursor?: string | null,
) {
  // dataSource is initialized with User in its entities configuration.
  const query = dataSource
    .getRepository(User)
    .createQueryBuilder("user")
    .where("user.ownerId = :ownerId", { ownerId });

  return paginator.paginate(query, { limit: 2, pageCursor });
}
```

Fetch the first page, then follow either cursor. These calls belong inside your application's async handler or function:

```typescript
const first = await readUsers(dataSource, 7);
const second = await readUsers(dataSource, 7, first.nextPageCursor);
const back = await readUsers(dataSource, 7, second.prevPageCursor);
```

The first call needs no cursor. Subsequent calls pass one of the returned cursors unchanged; backward pages arrive in the same display order as forward pages.
For four matching users `(4, "a")`, `(3, "b")`, `(2, "c")`, and `(1, "c")`, the example returns:

| Page     | Ordered IDs | `hasPrevPage` | `hasNextPage` | `totalCount` |
| -------- | ----------- | ------------- | ------------- | ------------ |
| `first`  | `4, 3`      | `false`       | `true`        | `4`          |
| `second` | `2, 1`      | `true`        | `false`       | `4`          |
| `back`   | `4, 3`      | `false`       | `true`        | `4`          |

The query builder is cloned, so it can be reused. Let the paginator own ordering and limits: pass a builder without `orderBy`, `take`, `skip`, `limit` or `offset` already set.
Keep authorization and filtering in the query, as `ownerId` does above, and restart from the first page when that scope changes.

## Page results and options

Every call returns a `Paginated<T>` object:

| Field                               | Meaning                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `nodes`                             | The page's entities, or the declared projection when using `paginateRaw`.                                                    |
| `hasNextPage` / `hasPrevPage`       | Whether matching records exist beyond each boundary at the time of its read. Both are checked by default.                    |
| `nextPageCursor` / `prevPageCursor` | Opaque tokens for requesting the next or previous page. Both exist on every nonempty page; both are `null` on an empty page. |
| `totalCount`                        | The number of matching root records across the query, before applying the cursor; `null` when counting is disabled.          |

Use availability flags to decide whether to show a navigation control. A cursor can still exist when its flag is false, allowing a later refresh beyond that boundary. See [empty pages and availability](docs/core-contract.md#page-availability-and-empty-pages) for the edge cases.

Pass these options to `paginator.paginate(query, options)`:

| Option                | Default               | Behavior                                                                                                                                                                  |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`               | All remaining records | A positive safe integer. Set it explicitly for ordinary paginated requests.                                                                                               |
| `pageCursor`          | No cursor             | A returned next/previous cursor; omit it to start at the first page.                                                                                                      |
| `noTotalCount`        | `false`               | Set to `true` to skip the count query and return `totalCount: null`.                                                                                                      |
| `noOppositePageCheck` | `false`               | Set to `true` to skip the opposite-direction probe on cursor requests; that unchecked flag becomes `null`. [Example](docs/usage.md#skip-counts-and-opposite-page-checks). |

Counts and availability checks are separate database reads. Concurrent changes can move records across a cursor or change metadata between reads; this API does not promise a snapshot across requests. Match indexes to your filters and ordering, and consult the [query costs and consistency contract](docs/core-contract.md#read-consistency-and-costs) when tuning a workload.

Invalid inputs produce a `PaginationInputError` with a stable `code`. For example, `UNSUPPORTED_CURSOR_VERSION` tells a consumer to discard the token and restart; see [handling errors](docs/usage.md#handle-invalid-cursors).

## Compatibility

| Surface          | Supported versions                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Node.js          | 22.13+ within 22.x, 24.11+ within 24.x, or 26+ within 26.x                                           |
| TypeORM          | `^0.3.21` or `^1.0.0`                                                                                |
| Databases tested | PostgreSQL with `pg`; SQLite with `better-sqlite3`                                                   |
| TypeScript       | 5.7.3+ within 5.x/6.x; NodeNext, Node16, legacy node and bundler resolution for Node-targeted builds |

TypeORM 0.3.21 accepts `better-sqlite3` 8–11; TypeORM 1.0.0 requires 12. Install a driver accepted by your TypeORM version. Browser execution and other database engines are outside the support policy; the [query contract](docs/core-contract.md#supported-queries-and-ownership) describes accepted adapters and query shapes.

Named imports work in both module formats:

```javascript
// CommonJS
const { CursorPaginator, paginate } = require("typeorm-cursor-paginate");
```

```javascript
// ESM
import { CursorPaginator, paginate } from "typeorm-cursor-paginate";
```

Use the package root for imports. The [usage guide](docs/usage.md#imports-and-types) covers exported types and the default function export.

## How it compares

- **TypeORM's offset pagination:** [`skip` and `take`](https://typeorm.io/docs/query-builder/select-query-builder#using-pagination) address a numbered slice of results. This package adds keyset pagination: navigation follows ordered values stored in an opaque cursor. It suits sequential browsing; it does not offer page numbers or arbitrary page jumps.
- **[`typeorm-paginator`](https://github.com/wan2land/typeorm-paginator):** this project's predecessor provides both cursor and numbered-page APIs, with separate next/previous cursor inputs. This fork focuses on cursor pagination, uses one directional `pageCursor`, and accepts TypeORM-style per-column ordering.
- **[`typeorm-cursor-pagination`](https://github.com/benjamin658/typeorm-cursor-pagination):** its documented API uses `paginationKeys`, a shared ordering direction, and separate before/after cursors. Here each column can have its own direction and NULL placement, while direction travels inside the cursor.

Choose based on the API and query shapes your application needs. [The supported-query table](docs/core-contract.md#supported-queries-and-ownership) spells out this package's boundaries, including joins, projections and unsupported aggregates.

## More examples and reference

- [Usage guide](docs/usage.md): standalone calls, ordering and NULLs, raw projections, custom cursor encoding, errors and exported types.
- [Core contract](docs/core-contract.md): supported queries, exact value representations, empty pages, consistency and database costs.
- [Migration guide](MIGRATION.md): changes required when moving from v2 to v3.
- [Release notes](CHANGELOG.md): changes in each version.

## Contributing

Bug reports and improvements are welcome. The [contributor guide](https://github.com/Oriery/typeorm-cursor-paginate/blob/main/CONTRIBUTING.md) explains setup, focused tests, database fixtures and package verification.

## License

[MIT](License). Forked from [`typeorm-paginator`](https://github.com/wan2land/typeorm-paginator).
