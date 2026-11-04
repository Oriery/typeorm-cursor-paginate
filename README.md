# TypeORM Cursor Paginator

Cursor pagination for TypeORM queries, with directional cursors, mixed ordering, explicit NULL placement, and entity or raw results. A cursor carries its direction, so the same `pageCursor` option requests the next or previous page.

**This checkout develops the unreleased v3 major release.** The core contracts below replace v2 behavior. Package entry points, packed consumer compatibility, runtime support policy, and npm publication remain part of [section B of the work plan](todo.md#b-public-api-and-distribution). Installing the currently published package does not provide these v3 contracts.

Read the [core contract](docs/core-contract.md) for supported queries, precise values, availability flags, and query costs. Existing consumers should start with the [migration guide](MIGRATION.md).

## Entity pages

The examples use the v3 source API exported by the package entry module. Include every primary-key column in `orderBy`; the paginator does not append a tie-breaker automatically.

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

async function readUsers(dataSource: DataSource, ownerId: number) {
  // dataSource is initialized with User in its entities configuration.
  const query = dataSource
    .getRepository(User)
    .createQueryBuilder("user")
    .where("user.ownerId = :ownerId", { ownerId });

  const first = await paginator.paginate(query, { limit: 2 });
  const second = await paginator.paginate(query, {
    limit: 2,
    pageCursor: first.nextPageCursor,
  });
  const back = await paginator.paginate(query, {
    limit: 2,
    pageCursor: second.prevPageCursor,
  });
  return { first, second, back };
}
```

The caller's builder, selections, and parameters remain unchanged, so the same query can be reused. Pagination owns ordering and limits: remove preconfigured `orderBy`, `take`, `skip`, `limit`, and `offset` before calling it.

For exactly four matching users `(4, "a")`, `(3, "b")`, `(2, "c")`, and `(1, "c")`, the pages are:

| Page   | Ordered IDs | `totalCount` | `hasPrevPage` | `hasNextPage` |
| ------ | ----------- | ------------ | ------------- | ------------- |
| First  | `4, 3`      | `4`          | `false`       | `true`        |
| Second | `2, 1`      | `4`          | `true`        | `false`       |

Equal names retain descending ID order. Each nonempty page has both `prevPageCursor` and `nextPageCursor`, even when the corresponding flag is false. Empty pages have null cursors; their flags follow the [empty-page contract](docs/core-contract.md#page-availability-and-empty-pages).

`limit` must be a positive safe integer. Omitting it deliberately returns all remaining matching roots. `noTotalCount: true` returns `totalCount: null` and skips the count query without weakening availability flags.

`checkOppositePage` defaults to `true`. For consumers that only need availability in the requested direction, set it to `false` to save one query on cursor requests:

```typescript
const forward = await paginator.paginate(query, {
  limit: 20,
  pageCursor: first.nextPageCursor,
  noTotalCount: true,
  checkOppositePage: false,
});
// hasNextPage remains a boolean; hasPrevPage is null (unchecked).
```

For backward requests, `hasPrevPage` remains known and `hasNextPage` becomes `null`. Cursorless pages keep both flags known without an extra query. Total counting is independent of this option. Default calls retain boolean flag types; opting out or passing a dynamic boolean returns `Paginated<TNode, boolean | null>`. See the [availability contract](docs/core-contract.md#page-availability-and-empty-pages) for empty pages and reusable options.

For a single call, use the named convenience function:

```typescript
import { paginate } from "typeorm-cursor-paginate";

const page = await paginate(User, query, {
  orderBy: { name: "ASC", id: "DESC" },
  limit: 20,
  noTotalCount: true,
});
```

Here and in the availability example, `query` is a builder prepared as in `readUsers`, and `first` is its first-page result. The source entry also retains `paginate` as a default export; package-level CJS/ESM behavior is still subject to section B's distribution checks.

## NULLs and raw projections

Order values accept TypeORM's uppercase/lowercase strings, `1`/`-1`, and direction/NULL-placement objects. NULLs default to `LAST` for both ascending and descending order.

```typescript
const byName = new CursorPaginator(User, {
  orderBy: {
    name: { direction: "asc", nulls: "last" },
    id: "DESC",
  },
});
```

Use `paginateRaw` for a SQL projection and declare its actual output type:

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

Raw mode still paginates root records. It supports to-one relation joins and rejects to-many joins before SQL. Entity mode supports to-many relation joins without truncating the selected roots' joined collections. Raw results use database-driver values; TypeORM column transformers apply to entity hydration only. Required boundary fields can be omitted from public projections: private selections supply them without adding them to returned objects.

## Errors and custom cursor encoding

Invalid cursors, ordering, limits, and unsupported query shapes produce a `PaginationInputError` with a stable `code`. For example, `UNSUPPORTED_CURSOR_VERSION` means an old token must be discarded and pagination restarted. See the [error table](docs/core-contract.md#errors-and-validation) and [custom codec example](docs/core-contract.md#custom-cursor-encoding).

Cursors preserve database boundary values, including PostgreSQL microseconds and exact bigint/numeric text. Base64 is an encoding, not authentication or encryption. Keep authorization predicates in every query and reset pagination when its filters change.

## Development and validation

```sh
npm ci
npm test
npm run test:postgres
npx tsc --noEmit --emitDeclarationOnly false
npm run build
```

The fast suite uses real SQLite through `better-sqlite3`. `test:postgres` starts and removes a disposable PostgreSQL 18 Docker container by default. Alternatively, set `PAGINATOR_POSTGRES_URL` to a test server login with `CREATE DATABASE` permission; the suite creates a unique database and drops it afterward. It does not reuse an application database. PostgreSQL tests deliberately use different process and database timezones.

The ordinary unit command skips PostgreSQL when no test URL is configured; passing it alone is insufficient evidence for the complete core contract. See [validation and measured costs](docs/core-contract.md#validation-and-measured-costs) and the [v3 backlog](todo.md) for the acceptance boundary.

## License

A fork of `typeorm-paginator`, released under the [MIT License](License).
