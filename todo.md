# v3 work plan

This is the execution backlog for the next major release of `typeorm-cursor-paginate`.
Breaking API and cursor-format changes are allowed; describe them in the migration guide.
The tasks combine the README backlog, the open timestamp issue, and a code audit of commit `6676ee5`.

## Execution order

| Section                                                          | Scope                                                                                  | Dependencies                  | Completion boundary                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------- |
| [A. Core correctness](#a-core-correctness)                       | Query safety, ordering, cursor values, raw results, page flags and regression coverage | None                          | Verified pagination behavior and documented contracts |
| [B. Public API and distribution](#b-public-api-and-distribution) | API cleanup, CJS/ESM, package contents, runtime support, documentation and CI          | A's contracts must be settled | Installable and verified v3 release candidate         |

Keep A's overlapping query and cursor changes in one coordinated implementation effort.
B's build and package-consumer fixture tests can use independent reviewers once the API is stable.

An agent assigned a section should read this overview and its prerequisites, implement the section, update affected documentation, and record validation with its commits or PRs.
Use coherent commits within each section rather than a separate execution session for every checkbox.
Mark a task complete only after its acceptance checks pass; record decisions where recommendations below leave a choice open.
Keep public examples and reproductions generic and self-contained.

## Audit baseline

- The existing suite passed 19 tests and skipped one; the build passed on Node 24.21.0.
- ESLint reported 15 warnings, so lint/format tooling already exists but needs a concrete cleanup.
- Nine failure scenarios were reproduced with real TypeORM and SQLite: parameter collision, caller-query mutation, ungrouped OR conditions, conflicting ordering, joined raw limits, NULL ordering, raw aliases, partial selections and duplicate ordering keys.
- Invalid limits and malformed cursor values also reached inconsistent JavaScript, ORM and database errors.
- Native ESM named imports failed against the built package; its default import resolved to a module object.
- A package dry run included both `src/cursor-paginator.test.ts` and `lib/cursor-paginator.test.d.ts`.
- PostgreSQL timestamp, timezone and precision coverage remains required; the SQLite audit is not evidence that those cases work.

## A. Core correctness

Failure examples in A1–A6 describe the recorded v2 audit; the checked contracts and fixes are the v3 outcome.

### A1. Establish the contracts and regression harness

- [x] Convert the failure descriptions below into committed regression tests before fixing them.
- [x] Add PostgreSQL integration fixtures alongside fast SQLite coverage, using isolated test databases and representative joined entities.
- [x] Define the supported query shapes: entity results, raw results, joins, partial selections, existing order/limit/offset, and aggregates or grouped queries.
      Support a shape correctly or reject it explicitly; do not imply every arbitrary `SelectQueryBuilder` is supported.
- [x] Define whether pagination owns ordering and limits, and how a preconfigured query is handled.
      Recommendation: clone the caller's query first and reject incompatible configuration rather than silently combine two pagination schemes.
- [x] Define total-count semantics for each supported result mode and whether separate reads offer snapshot consistency.
      Do not promise a consistent snapshot across concurrent writes without implementing one.
- [x] Record the cursor version, supported value types/precision, invalid-input error contract and migration behavior before B freezes the public API.

Acceptance: tests assert full ordered traversal in both directions, not only individual pages, and verify that the original query and its parameters remain unchanged.
Include mixed directions, equal values with a unique tie-breaker, empty and short pages, deleted boundary rows, joins and filtered queries.

### A2. Preserve query meaning and isolate cursor parameters

Source: [query composition](src/cursor-paginator.ts) in `paginate` and `_applyWhereQuery`.

- [x] Clone before adding cursor predicates or ordering.
      Reusing one builder across five records currently yields counts `5, 5, 3`, then an empty backward page because accumulated predicates include both `id > boundary` and `id < boundary`.
- [x] Allocate parameter names that cannot collide with parameters already present in the query, including joins and subqueries.
      A filter `ownerId = :cursor__id` with value `1` is currently changed to owner `2` by a cursor containing `id: 2`.
      Preserve security filters and test parameter isolation directly.
- [x] Group the existing predicate before combining it with the cursor predicate.
      Existing `A OR B` must become `(A OR B) AND cursor`, not `A OR (B AND cursor)`.
- [x] Reject or deliberately replace conflicting existing ordering.
      Appending ID ordering after caller-provided name ordering currently produces duplicate records across pages.
- [x] Preserve parameterized cursor values and extend the existing hostile-string tests to composed queries and supported drivers.
- [x] Validate ordering identifiers against actual metadata or an explicit supported mapping before putting them into SQL.
      TypeScript's `keyof TEntity` is not a runtime database-column allowlist.
- [x] Resolve the source TODO proposing nested WHERE objects according to the actual safety requirements.
      An object rewrite is optional; correct grouping, validated identifiers and bound values are mandatory.

The parameter collision is a conditional security defect in query composition.
The audit did not establish SQL injection through ordinary cursor values, which are already bound as parameters.

### A3. Ordering, NULLs and unique boundaries

Sources: [normalizeOrderBy](src/utils/normalizeOrderBy.ts) and [ordering types](src/interfaces/paginator.ts).

- [x] Support TypeORM's `FindOptionsOrderValue` forms: uppercase/lowercase directions, numeric directions and objects with direction/null placement.
      Normalize them into one internal representation; reject unknown values instead of silently interpreting them as descending.
- [x] Implement NULL-aware lexicographic comparisons and reverse both ordering and NULL placement correctly when paging backward.
      A NULL boundary currently ends traversal despite remaining records.
- [x] Reject duplicate ordering keys, including duplicates across array entries.
      `[{ id: "ASC" }, { id: "ASC" }]` currently produces a cursor that fails its own key-count validation.
- [x] Keep deterministic unique ordering explicit.
      Decide whether to require a caller-supplied unique tuple or append an appropriate key; document and test the policy rather than silently changing it.
- [x] Define support for embedded property paths and renamed database columns; reject unsupported relation/computed-property ordering.
- [x] Test all accepted direction forms and NULL placements with ties, multiple columns and both traversal directions on supported drivers.

### A4. Cursor values, timestamps and invalid inputs

Sources: [cursor parsing and extraction](src/cursor-paginator.ts), [transformers](src/transformers) and [timestamp issue #1](https://github.com/Oriery/typeorm-cursor-paginate/issues/1).

- [x] Parse external cursor data as `unknown` and validate its envelope, direction, version, keys and supported value representations before query execution.
      Reject primitives, arrays, unexpected objects, missing/extra keys and NULL for nonnullable keys with a stable pagination-input error.
- [x] Validate `limit` as a finite positive safe integer, leaving any deliberately supported unlimited mode explicit.
      `NaN`, `Infinity` and fractional values currently reach ORM or database errors.
- [x] Define bounded input handling and stable errors for malformed encoding, malformed JSON, unsupported versions and oversized tokens.
- [x] Define cursor compatibility with ordering and filters.
      Recommendation: include enough version/order information to reject incompatible cursors; document when callers must reset pagination after changing filters.
      Cursors do not replace query authorization, and Base64 is not encryption or authentication.
- [x] Establish the supported serialization contract for dates, large integers, decimals and custom column transformers.
      Preserve precision or reject unsupported representations instead of silently truncating or coercing them.
- [x] Resolve timestamp issue #1 with PostgreSQL regressions for process/database timezone differences, a DST boundary, millisecond and sub-millisecond values, equal timestamps and both directions.
- [x] Preserve exact database boundary values when hydration would lose precision, or explicitly constrain supported storage precision.
      A JavaScript `Date` cannot recover microseconds already discarded during hydration; changing JSON parsing alone is not a fix.
- [x] Verify TypeORM column-transformer behavior in both directions without double transformation.
- [x] Define v2-token handling for v3: reject with a recognizable error and documented restart behavior, or implement and test an intentional compatibility reader.

Acceptance: unsupported inputs fail before SQL execution, supported values round-trip without changing their ordering meaning, and the timestamp fix is demonstrated against PostgreSQL rather than inferred from SQLite.

### A5. Raw results and partial projections

Source: [result retrieval and cursor extraction](src/cursor-paginator.ts).

- [x] Decide whether raw mode paginates raw SQL rows or root entities when joins multiply rows.
      State corresponding limits, ordering, counts and flags explicitly.
- [x] Replace the untyped positional `isRaw` behavior with a deliberate API and honest output typing in coordination with B1.
- [x] Map cursor values from selected raw aliases and metadata rather than assuming raw objects have entity property names.
      A normal `{ u_id: 1 }` result currently becomes an empty cursor when ordered by `id`.
- [x] Enforce limits for joined raw queries.
      `.take(limit + 1)` with `getRawMany()` currently retrieves all joined rows in the reproduced case, then throws on the unexpected result count.
      Do not globally replace `.take` with `.limit`: that can truncate joined entity results.
- [x] Handle partial selections by obtaining required boundary values safely or rejecting the projection before querying.
      Selecting only ID while ordering by name and ID currently produces a cursor missing name.
      Internal boundary selections must not accidentally expose fields omitted from the public result.
- [x] Cover custom aliases, renamed columns, to-one/to-many joins, empty pages, counts and both traversal directions.

### A6. Page availability and query costs

Sources: [page flags](src/cursor-paginator.ts), [public result contract](src/interfaces/paginator.ts) and the skipped deletion test in [the test suite](src/cursor-paginator.test.ts).

- [x] Revisit the assumption that supplying a cursor proves a page exists in the opposite direction.
      Decide and document the v3 behavior before changing clients' expectations.
- [x] Recommendation: make ordinary `hasPrevPage` and `hasNextPage` accurately report availability in both directions.
      Measure indexed existence probes or another bounded strategy; avoid full counts solely to compute flags.
      If approximate flags remain, expose and name that behavior explicitly.
- [x] Preserve useful boundary cursors on nonempty pages even when a corresponding availability flag is false.
      Define the empty-page behavior separately.
- [x] Replace the skipped opposite-direction deletion test with an active test for the chosen contract.
      Add backward paging, deletion of all earlier/later rows, and mutation between reads.
- [x] Keep `noTotalCount` independent of page availability, and verify that it suppresses the count query.
- [x] Add `noOppositePageCheck: true` as an explicit opt-out (default `false`, matching `noTotalCount`) from opposite-direction probes, keeping checked boolean flags by default and nullable types only for opted-out or dynamic calls.
      Preserve known cursorless flags, requested-direction lookahead, both boundary cursors, and independence from total counting; verify the saved query in SQLite and PostgreSQL.
- [x] Measure query counts and joined-row fan-out for the final algorithms; document the supported consistency guarantees and cost of exact flags.

### A completion and validation — 2026-11-04

Section A is complete in source for the unreleased `3.0.0-next.0` version.
The [core contract](docs/core-contract.md) records supported and rejected shapes,
value representations, consistency limits, and measured costs; the
[migration guide](MIGRATION.md) records deliberate v2 breaks.

Decisions applied throughout A:

- Pagination clones the caller, owns ordering/limits, validates mapped root columns,
  and requires every root primary-key component explicitly. It rejects incompatible
  query shapes instead of silently combining pagination schemes.
- NULLs default to LAST in either direction. Backward traversal reverses both
  order and NULL placement. Cursors bind the normalized ordering, but callers
  must restart after changing filters, authorization scope, entity, or database.
- Version 3 stores validated database scalar boundaries, preserving PostgreSQL
  microseconds and exact bigint/numeric values before hydration. V2 tokens are
  rejected with a recognizable restart error. Custom codecs parse `unknown`.
- Typed `paginateRaw` paginates root rows and permits only to-one joins. Entity
  mode pages distinct roots before hydration, retains full joined collections,
  and keeps private sort/identity selections out of partial results.
- Counts use distinct SQL primary-key tuples, avoiding TypeORM's composite-key
  concatenation collisions. Entity hydration batches large pages and isolates
  colliding composite root identities; unsupported joined identity shapes fail
  before SQL rather than silently losing related entities.
- Availability defaults to lookahead plus an opposite-direction bounded-output probe,
  independently of totals. `noOppositePageCheck: true` saves the opposite probe on
  cursor requests and returns `null` only for the unchecked direction. Empty pages have null cursors and use the supplied
  boundary for an inclusive opposite probe. Separate reads do not promise a
  snapshot during concurrent changes.

Regression-first commit `8faf9ae` captured 46 SQLite composition/traversal tests
(44 failing on v2), 77 input-contract tests (76 failing), and 13 integration tests
run against an isolated PostgreSQL 18 database (all failing). Independent review
expanded coverage to 65 core SQLite tests, 96 input tests, 20 active original-suite
tests, and 40 PostgreSQL tests. The former skipped deletion case is active.

Initial local acceptance results (before the optional opposite-page checks):

| Runtime / TypeORM             | SQLite fixture                        | PostgreSQL fixture | Result                                                                             |
| ----------------------------- | ------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| Node 24.21.0 / TypeORM 1.1.1  | better-sqlite3 12.11.1, SQLite 3.53.2 | PostgreSQL 18      | 181 SQLite/input tests + 40 PostgreSQL tests passed; lint, typecheck, build passed |
| Node 22.23.4 / TypeORM 0.3.21 | better-sqlite3 11.10.0, SQLite 3.49.2 | PostgreSQL 18      | Same 221 tests passed; lint, typecheck, build passed                               |

Commands: `npm test`, `npm run test:postgres`,
`npx tsc --noEmit --emitDeclarationOnly false`, and `npm run build`.
The PostgreSQL harness owns a disposable Docker service unless an administrative
`PAGINATOR_POSTGRES_URL` is supplied; it creates and removes a unique database.
The normal unit command skips the 40 PostgreSQL cases without that URL, and the
separate PostgreSQL command ran all of them for both combinations above.
Normal lockfile dependencies were restored with `npm ci` and reverified.

The optional opposite-page checks have a separate regression-first commit,
`edb8696`: 21 of 25 new SQLite cases and all 4 new PostgreSQL cases failed before
implementation. The complete updated suite passes locally on the normal Node 24 /
TypeORM 1.1.1 dependencies: **206 SQLite/input tests and 44 actual PostgreSQL tests**,
plus lint, typecheck, and build. Tests assert exactly one saved probe, first/empty
page semantics, independent totals, immutable queries/cursors, and boolean-default
versus nullable opt-out/dynamic result types for instance and standalone APIs.
The overloads expose TypeScript's TS7022 inference cycle in some cursor-reassignment
loops; an explicit page-result annotation resolves it without widening default
flags. The contract and migration guide document this tradeoff.

The [implementation CI run](https://github.com/Oriery/typeorm-cursor-paginate/actions/runs/41814281266)
passed all eight jobs: six existing Node 22/24/26 × TypeORM 0.3/1 jobs and two
targeted PostgreSQL jobs for the exact dependency pairs above.

Measured on 10,007 PostgreSQL roots: with limit 2, the key query returned 3 roots,
hydration returned 4 joined rows for the 2 retained roots, and the opposite probe
used an index and returned 1 row. Ordinary nonempty entity/raw pages use 2/1 reads,
plus an opposite probe when a cursor is supplied and checks are enabled, and a count unless disabled.
Large entity pages and actual composite identity collisions require additional
hydration batches. LIMIT bounds returned probe rows, not necessarily scanned work.

Unresolved boundaries belong to B or are explicit supported-behavior limits:

- The legacy build/pack/ESM defects remain; a passing core build is not a verified
  installable release. No npm publication was performed.
- Node 24 with the old SQLite 11 native driver crashed during Jest VM cleanup;
  the valid minimum-dependency check uses Node 22. TypeORM 0.3.21 does not declare
  compatibility with SQLite driver 12. CI records the tested pairs without
  forcing an invalid peer combination. B must finalize the wider runtime policy.
- The separate `sqlite3` adapter is accepted by the core but has not been exercised
  independently; SQLite evidence here comes from `better-sqlite3`.
- The core contract explicitly rejects unsupported query/value/storage shapes;
  no snapshot guarantee or arbitrary query-builder support is implied.

## B. Public API and distribution

A supplies the source API and behavioral documentation checked below. Package-consumer
verification, the final support policy, and publication remain separate B acceptance work.

### B1. Finalize the v3 API

Sources: [package entry](src/index.ts), [standalone paginate](src/paginate.ts) and [public interfaces](src/interfaces/paginator.ts).

- [x] Rename `CursorPaginatorParams.transformer` to `cursorTransformer` and document the breaking change.
- [x] Export all intended public option/result/error types, including the standalone function's options, using explicit type-only exports where appropriate.
      Do not expose interfaces as undefined runtime exports.
- [ ] Recommendation: document named `paginate` and `CursorPaginator` exports as the primary API.
      Decide deliberately whether a default export remains, and test its real runtime meaning if retained.
- [x] Finalize raw-mode overloads or a separate raw API with the output and boundary types from A5.
- [x] Remove the redundant entity argument or validate it against query metadata.
      The entity argument is retained and validated against root query metadata.
- [x] Publish the validated cursor-transformer, supported-query and error contracts from A.

### B2. Build and package entry points

Sources: [package.json](package.json), [production TypeScript configuration](tsconfig.build.json), [SWC build configuration](build.swcrc) and [.npmignore](.npmignore).

- [ ] Build production output through an explicit production TypeScript configuration that excludes tests.
- [ ] Replace SWC's production CJS export emission with `tsc` or another verified approach.
      The existing dynamic export helper prevents native ESM named-import detection.
- [ ] Provide a native ESM entry point and an explicit `exports` map with appropriate declarations for supported consumers.
      Fixing CJS named-export detection alone does not make its default import equal the default-exported function.
- [ ] Consider a single canonical CJS implementation with a small ESM facade instead of two independent implementations.
      Validate shared constructor identity and correct type resolution if choosing this approach.
- [ ] Decide which deep imports are supported; document intentionally removed `lib/...` access as a v3 migration change.
- [ ] Replace broad packaging rules with an intentional file allowlist or equally explicit policy.
      Exclude test sources/declarations and inspect the tarball; retain license, README and any intentionally shipped sources/maps.
- [ ] Verify that clean builds and packed artifacts are reproducible and contain matching JavaScript and declarations.

### B3. Support policy, CI and maintenance

Sources: [CI workflow](.github/workflows/ci.yml), [lint configuration](eslint.config.mjs) and [dependency update PR #16](https://github.com/Oriery/typeorm-cursor-paginate/pull/16).

- [ ] Add `engines` and align the compilation target, documentation and runtime test matrix.
      Choose runtime support separately from development-tool requirements, accounting for the supported TypeORM versions' own engine constraints.
- [ ] Test the exact minimum supported Node/TypeORM combinations as well as current supported branches.
      Floating `typeorm@0.3` and `typeorm@1` do not verify the advertised lower bounds `0.3.21` and `1.0.0`.
- [ ] Add explicit typechecking and production-build checks to CI.
- [ ] Pack the package and install the tarball into clean CommonJS, native ESM and TypeScript consumer fixtures.
      Test the public entry points rather than relying only on source imports transformed by Jest.
- [ ] Include TypeScript NodeNext and other deliberately supported module-resolution modes in consumer checks.
- [ ] Run PostgreSQL regressions in CI alongside SQLite and validate package contents automatically.
      A adds targeted real-database jobs for the verified dependency pairs; automatic package-content validation remains.
- [ ] Resolve meaningful lint warnings and align ESLint/Prettier with the chosen source/module setup.
      The tools are already configured; replace the old vague setup task with concrete fixes.
- [ ] Review and rebase or supersede the existing dependency update against the v3 toolchain, without blindly repeating the dependency compatibility work completed in 2.2.0.
- [ ] Keep CI scopes and timeouts sufficient for the new checks, and avoid an unnecessarily large Cartesian product when targeted compatibility jobs provide the required evidence.

### B4. Documentation and migration

- [ ] Add a tested `CursorTransformer` example using the final option name and validation contract.
- [x] Document `noTotalCount`, its default, result shape and query-cost tradeoffs.
- [x] Document unique ordering, NULL handling, supported values/precision, query ownership, raw mode, flags, errors and consistency limits.
- [x] Correct the README example whose equal-name IDs are shown ascending despite descending ID ordering.
- [ ] Execute or otherwise verify the documented import and pagination examples against built artifacts.
- [ ] Add a v2-to-v3 migration guide covering exports, options, types, supported runtimes, deep imports and old cursor invalidation/restart.
      The core migration guide exists; finalize runtime/module/deep-import sections after distribution checks.
- [x] Keep the README linked to this backlog instead of duplicating task lists.

Acceptance for B: a packed v3 release candidate installs and works in all documented consumer forms; its types, runtime exports, examples and published file list agree.
