# TypeORM Cursor Paginator

Cursor pagination for TypeORM queries, with directional cursors, mixed ordering, explicit NULL placement, and entity or raw results. A cursor carries its direction, so the same `pageCursor` option requests the next or previous page.

**v3.0.0 is prepared for release.** This deliberate major release replaces v2 behavior. Until publication, install the verified local tarball; the published v2 package does not provide these contracts. See the [release notes](CHANGELOG.md) for changes and publication verification.

Read the [core contract](docs/core-contract.md) for supported queries, precise values, availability flags, and query costs. Existing consumers should start with the [migration guide](MIGRATION.md).

## Installation and imports

Build the release artifact from this checkout, then install it in a consumer:

```sh
npm ci
npm run check
npm pack --pack-destination /tmp
# In the consuming project:
npm install /tmp/typeorm-cursor-paginate-3.0.0.tgz
```

Install TypeORM and a supported database driver in the consumer as well. Use the package root for every public import:

```javascript
// CommonJS
const {
  paginate,
  paginateRaw,
  CursorPaginator,
} = require("typeorm-cursor-paginate");
```

```javascript
// Native ESM
import {
  paginate,
  paginateRaw,
  CursorPaginator,
} from "typeorm-cursor-paginate";
```

Named exports are the primary API. The default export remains an alias of `paginate`: `import paginate from "typeorm-cursor-paginate"` in native ESM, or `require("typeorm-cursor-paginate").default` in CommonJS. `require(...)` itself returns a namespace object. Both module formats share one implementation, so constructors and `instanceof PaginationInputError` retain identity across them.

The only other public subpath is `typeorm-cursor-paginate/package.json`. Deep `lib/...` and `src/...` imports are unsupported and blocked. The tarball includes compiled JavaScript, declarations, license, README, migration guide, release notes and core contract, with no tests, source maps, or source files.

| Support surface          | Policy                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Node runtime             | 22.13.0+ within 22.x; 24.11.0+ within 24.x; 26.0.0+ within 26.x                                                                             |
| TypeORM peer             | 0.3.21+ within 0.3.x; 1.0.0+ within 1.x                                                                                                     |
| Tested database adapters | `better-sqlite3` and PostgreSQL (`pg`); see the [query contract](docs/core-contract.md#supported-queries-and-ownership) for accepted shapes |
| TypeScript consumer      | 5.7.3+ within 5.x/6.x; NodeNext, Node16, legacy node/node10, and bundler resolution                                                         |
| Development tools        | Node 24.11+ within 24.x is the reference environment, npm 11, locked TypeScript 6.0; other runtime floors are tested independently          |

Runtime support follows [maintained Node release lines](https://nodejs.org/en/about/previous-releases) and TypeORM 1's engine floors. CI runs on Node 24 and 26; Node 22 compatibility was verified during release preparation but is not continuously tested. TypeORM 0.3.21 requires better-sqlite3 8–11; TypeORM 1.0.0 requires 12. The test matrix uses 11.10.0 and 12.11.1 respectively, without forcing incompatible peers. TypeScript fixtures use Node ambient types and `ESNext.Disposable` for TypeORM 1, with full declaration checking. Bundler resolution verifies types for Node-targeted builds; browser execution is outside this package's support policy.

## Entity pages

The examples use the installed v3 package entry point. Include every primary-key column in `orderBy`; the paginator does not append a tie-breaker automatically.

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

`noOppositePageCheck` defaults to `false`, like `noTotalCount`. For consumers that only need availability in the requested direction, set it to `true` to save one query on cursor requests:

```typescript
const forward = await paginator.paginate(query, {
  limit: 20,
  pageCursor: first.nextPageCursor,
  noTotalCount: true,
  noOppositePageCheck: true,
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

Here and in the availability example, `query` is a builder prepared as in `readUsers`, and `first` is its first-page result. The standalone function retains the entity argument and validates it against the query’s root metadata, just like the class.

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

Without a declared `TRaw`, both raw APIs return `Record<string, unknown>` rows. The standalone form is `paginateRaw<UserRow, User>(User, rawQuery, options)`. Raw mode still paginates root records. It supports to-one relation joins and rejects to-many joins before SQL. Entity mode supports to-many relation joins without truncating the selected roots' joined collections. Raw results use database-driver values; TypeORM column transformers apply to entity hydration only. Required boundary fields can be omitted from public projections: private selections supply them without adding them to returned objects.

## Errors and custom cursor encoding

Invalid cursors, ordering, limits, and unsupported query shapes produce a `PaginationInputError` with a stable `code`. For example, `UNSUPPORTED_CURSOR_VERSION` means an old token must be discarded and pagination restarted. See the [error table](docs/core-contract.md#errors-and-validation) and [custom codec example](docs/core-contract.md#custom-cursor-encoding).

A custom codec implements the following interface. `parse` returns `unknown`; the paginator validates the decoded envelope and database representations before querying:

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

Pass it as `cursorTransformer: new JsonCursorTransformer()` alongside `orderBy`. The paginator owns the `v3:` prefix and 16,384-character token bound. Codecs must preserve the complete envelope and database values without mutation or column transformations. A codec exception or malformed decoded input produces `INVALID_CURSOR`. The removed `transformer` option and malformed codec methods produce `INVALID_OPTION`; they never silently select a different codec. `JsonTransformer` is the equivalent built-in JSON codec, and `Base64Transformer` is the default Base64URL codec.

All option/result/cursor types are available from the root through `import type`: `PaginateOptions`, `CursorPaginatorParams`, `CursorPaginatorPaginateParams`, `Paginated`, `Order`, `OrderBy`, `NormalizedOrder`, `CursorEnvelope`, `CursorValue`, `CursorTransformer`, and `PaginationInputErrorCode`. They are not runtime exports.

Cursors preserve database boundary values, including PostgreSQL microseconds and exact bigint/numeric text. Base64 is an encoding, not authentication or encryption. Keep authorization predicates in every query and reset pagination when its filters change.

## Development and validation

```sh
npm ci
npm test
npm run test:postgres
npm run typecheck
npm run test:package
# Or run all of the above, including PostgreSQL and packed consumers:
npm run check
```

`npm run test:package` builds and packs twice, checks reproducibility and the file allowlist, installs the tarball in a clean temporary project, and exercises CJS, ESM, TypeScript consumers, and README examples. `npm run test:lint` rejects warnings; `npm run test:format` checks repository formatting and `npm run format` applies it. Production compilation excludes tests and emits ES2022 JavaScript plus matching declarations. SWC is used only to transform Jest tests. The ESM facade uses the canonical CommonJS implementation and declarations to preserve identity across module formats; separate duplicate builds add complexity without a runtime benefit here.

The toolchain supersedes the closed [dependency update PR #16](https://github.com/Oriery/typeorm-cursor-paginate/pull/16). TypeORM-compatible SQLite 12 and TypeScript 6.0 remain pinned by their supported dependency ranges. Exact minimatch/glob overrides address development-tool advisories until upstream ranges accept their patched versions. The remaining low-severity deepmerge advisory is confined to Jest configuration merging, is absent from the distributed runtime, and is tracked in [issue #20](https://github.com/Oriery/typeorm-cursor-paginate/issues/20).

The fast suite uses real SQLite through `better-sqlite3`. `test:postgres` starts and removes a disposable PostgreSQL 18 Docker container by default. Alternatively, set `PAGINATOR_POSTGRES_URL` to a test server login with `CREATE DATABASE` permission; the suite creates a unique database and drops it afterward. It does not reuse an application database. PostgreSQL tests deliberately use different process and database timezones.

The ordinary unit command skips PostgreSQL when no test URL is configured; passing it alone is insufficient evidence for the complete core contract. See [validation and measured costs](docs/core-contract.md#validation-and-measured-costs) and the [v3 backlog](https://github.com/Oriery/typeorm-cursor-paginate/blob/main/todo.md) for the acceptance boundary.

## License

A fork of `typeorm-paginator`, released under the [MIT License](License).
