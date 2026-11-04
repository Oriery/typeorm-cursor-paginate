# v3 work plan

This is the execution backlog for the next major release of `typeorm-cursor-paginate`.
Breaking API and cursor-format changes are allowed; describe them in the migration guide.
The tasks combine the README backlog, the open timestamp issue, and a code audit of commit `6676ee5`.

## Execution order

| Section | Scope | Dependencies | Completion boundary |
| --- | --- | --- | --- |
| [A. Core correctness](#a-core-correctness) | Query safety, ordering, cursor values, raw results, page flags and regression coverage | None | Verified pagination behavior and documented contracts |
| [B. Public API and distribution](#b-public-api-and-distribution) | API cleanup, CJS/ESM, package contents, runtime support, documentation and CI | A's contracts must be settled | Installable and verified v3 release candidate |

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

### A1. Establish the contracts and regression harness

- [x] Convert the failure descriptions below into committed regression tests before fixing them.
- [x] Add PostgreSQL integration fixtures alongside fast SQLite coverage, using isolated test databases and representative joined entities.
- [ ] Define the supported query shapes: entity results, raw results, joins, partial selections, existing order/limit/offset, and aggregates or grouped queries.
      Support a shape correctly or reject it explicitly; do not imply every arbitrary `SelectQueryBuilder` is supported.
- [ ] Define whether pagination owns ordering and limits, and how a preconfigured query is handled.
      Recommendation: clone the caller's query first and reject incompatible configuration rather than silently combine two pagination schemes.
- [ ] Define total-count semantics for each supported result mode and whether separate reads offer snapshot consistency.
      Do not promise a consistent snapshot across concurrent writes without implementing one.
- [ ] Record the cursor version, supported value types/precision, invalid-input error contract and migration behavior before B freezes the public API.

Acceptance: tests assert full ordered traversal in both directions, not only individual pages, and verify that the original query and its parameters remain unchanged.
Include mixed directions, equal values with a unique tie-breaker, empty and short pages, deleted boundary rows, joins and filtered queries.

### A2. Preserve query meaning and isolate cursor parameters

Source: [query composition](src/cursor-paginator.ts) in `paginate` and `_applyWhereQuery`.

- [ ] Clone before adding cursor predicates or ordering.
      Reusing one builder across five records currently yields counts `5, 5, 3`, then an empty backward page because accumulated predicates include both `id > boundary` and `id < boundary`.
- [ ] Allocate parameter names that cannot collide with parameters already present in the query, including joins and subqueries.
      A filter `ownerId = :cursor__id` with value `1` is currently changed to owner `2` by a cursor containing `id: 2`.
      Preserve security filters and test parameter isolation directly.
- [ ] Group the existing predicate before combining it with the cursor predicate.
      Existing `A OR B` must become `(A OR B) AND cursor`, not `A OR (B AND cursor)`.
- [ ] Reject or deliberately replace conflicting existing ordering.
      Appending ID ordering after caller-provided name ordering currently produces duplicate records across pages.
- [ ] Preserve parameterized cursor values and extend the existing hostile-string tests to composed queries and supported drivers.
- [ ] Validate ordering identifiers against actual metadata or an explicit supported mapping before putting them into SQL.
      TypeScript's `keyof TEntity` is not a runtime database-column allowlist.
- [ ] Resolve the source TODO proposing nested WHERE objects according to the actual safety requirements.
      An object rewrite is optional; correct grouping, validated identifiers and bound values are mandatory.

The parameter collision is a conditional security defect in query composition.
The audit did not establish SQL injection through ordinary cursor values, which are already bound as parameters.

### A3. Ordering, NULLs and unique boundaries

Sources: [normalizeOrderBy](src/utils/normalizeOrderBy.ts) and [ordering types](src/interfaces/paginator.ts).

- [ ] Support TypeORM's `FindOptionsOrderValue` forms: uppercase/lowercase directions, numeric directions and objects with direction/null placement.
      Normalize them into one internal representation; reject unknown values instead of silently interpreting them as descending.
- [ ] Implement NULL-aware lexicographic comparisons and reverse both ordering and NULL placement correctly when paging backward.
      A NULL boundary currently ends traversal despite remaining records.
- [ ] Reject duplicate ordering keys, including duplicates across array entries.
      `[{ id: "ASC" }, { id: "ASC" }]` currently produces a cursor that fails its own key-count validation.
- [ ] Keep deterministic unique ordering explicit.
      Decide whether to require a caller-supplied unique tuple or append an appropriate key; document and test the policy rather than silently changing it.
- [ ] Define support for embedded property paths and renamed database columns; reject unsupported relation/computed-property ordering.
- [ ] Test all accepted direction forms and NULL placements with ties, multiple columns and both traversal directions on supported drivers.

### A4. Cursor values, timestamps and invalid inputs

Sources: [cursor parsing and extraction](src/cursor-paginator.ts), [transformers](src/transformers) and [timestamp issue #1](https://github.com/Oriery/typeorm-cursor-paginate/issues/1).

- [ ] Parse external cursor data as `unknown` and validate its envelope, direction, version, keys and supported value representations before query execution.
      Reject primitives, arrays, unexpected objects, missing/extra keys and NULL for nonnullable keys with a stable pagination-input error.
- [ ] Validate `limit` as a finite positive safe integer, leaving any deliberately supported unlimited mode explicit.
      `NaN`, `Infinity` and fractional values currently reach ORM or database errors.
- [ ] Define bounded input handling and stable errors for malformed encoding, malformed JSON, unsupported versions and oversized tokens.
- [ ] Define cursor compatibility with ordering and filters.
      Recommendation: include enough version/order information to reject incompatible cursors; document when callers must reset pagination after changing filters.
      Cursors do not replace query authorization, and Base64 is not encryption or authentication.
- [ ] Establish the supported serialization contract for dates, large integers, decimals and custom column transformers.
      Preserve precision or reject unsupported representations instead of silently truncating or coercing them.
- [ ] Resolve timestamp issue #1 with PostgreSQL regressions for process/database timezone differences, a DST boundary, millisecond and sub-millisecond values, equal timestamps and both directions.
- [ ] Preserve exact database boundary values when hydration would lose precision, or explicitly constrain supported storage precision.
      A JavaScript `Date` cannot recover microseconds already discarded during hydration; changing JSON parsing alone is not a fix.
- [ ] Verify TypeORM column-transformer behavior in both directions without double transformation.
- [ ] Define v2-token handling for v3: reject with a recognizable error and documented restart behavior, or implement and test an intentional compatibility reader.

Acceptance: unsupported inputs fail before SQL execution, supported values round-trip without changing their ordering meaning, and the timestamp fix is demonstrated against PostgreSQL rather than inferred from SQLite.

### A5. Raw results and partial projections

Source: [result retrieval and cursor extraction](src/cursor-paginator.ts).

- [ ] Decide whether raw mode paginates raw SQL rows or root entities when joins multiply rows.
      State corresponding limits, ordering, counts and flags explicitly.
- [ ] Replace the untyped positional `isRaw` behavior with a deliberate API and honest output typing in coordination with B1.
- [ ] Map cursor values from selected raw aliases and metadata rather than assuming raw objects have entity property names.
      A normal `{ u_id: 1 }` result currently becomes an empty cursor when ordered by `id`.
- [ ] Enforce limits for joined raw queries.
      `.take(limit + 1)` with `getRawMany()` currently retrieves all joined rows in the reproduced case, then throws on the unexpected result count.
      Do not globally replace `.take` with `.limit`: that can truncate joined entity results.
- [ ] Handle partial selections by obtaining required boundary values safely or rejecting the projection before querying.
      Selecting only ID while ordering by name and ID currently produces a cursor missing name.
      Internal boundary selections must not accidentally expose fields omitted from the public result.
- [ ] Cover custom aliases, renamed columns, to-one/to-many joins, empty pages, counts and both traversal directions.

### A6. Page availability and query costs

Sources: [page flags](src/cursor-paginator.ts), [public result contract](src/interfaces/paginator.ts) and the skipped deletion test in [the test suite](src/cursor-paginator.test.ts).

- [ ] Revisit the assumption that supplying a cursor proves a page exists in the opposite direction.
      Decide and document the v3 behavior before changing clients' expectations.
- [ ] Recommendation: make ordinary `hasPrevPage` and `hasNextPage` accurately report availability in both directions.
      Measure indexed existence probes or another bounded strategy; avoid full counts solely to compute flags.
      If approximate flags remain, expose and name that behavior explicitly.
- [ ] Preserve useful boundary cursors on nonempty pages even when a corresponding availability flag is false.
      Define the empty-page behavior separately.
- [ ] Replace the skipped opposite-direction deletion test with an active test for the chosen contract.
      Add backward paging, deletion of all earlier/later rows, and mutation between reads.
- [ ] Keep `noTotalCount` independent of page availability, and verify that it suppresses the count query.
- [ ] Measure query counts and joined-row fan-out for the final algorithms; document the supported consistency guarantees and cost of exact flags.

### A regression baseline

The regression-first commit adds 46 SQLite composition/traversal tests (44 failing on v2),
77 input-contract tests (76 failing on v2), and 13 integration tests run against a disposable
PostgreSQL 18 database (all failing on v2). The failures include the recorded query reuse,
filter collision, OR grouping, NULL traversal, timestamp precision, raw and projection defects.
`npm run test:postgres` owns and removes a disposable Docker service unless an administrative
`PAGINATOR_POSTGRES_URL` is supplied; the suite creates and drops a unique test database.
These are failing acceptance tests at this point, not evidence of completed implementation.

## B. Public API and distribution

### B1. Finalize the v3 API

Sources: [package entry](src/index.ts), [standalone paginate](src/paginate.ts) and [public interfaces](src/interfaces/paginator.ts).

- [ ] Rename `CursorPaginatorParams.transformer` to `cursorTransformer` and document the breaking change.
- [ ] Export all intended public option/result/error types, including the standalone function's options, using explicit type-only exports where appropriate.
      Do not expose interfaces as undefined runtime exports.
- [ ] Recommendation: document named `paginate` and `CursorPaginator` exports as the primary API.
      Decide deliberately whether a default export remains, and test its real runtime meaning if retained.
- [ ] Finalize raw-mode overloads or a separate raw API with the output and boundary types from A5.
- [ ] Remove the redundant entity argument or validate it against query metadata.
      It is currently stored but does not govern the query target used by the algorithm.
- [ ] Publish the validated cursor-transformer, supported-query and error contracts from A.

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
- [ ] Resolve meaningful lint warnings and align ESLint/Prettier with the chosen source/module setup.
      The tools are already configured; replace the old vague setup task with concrete fixes.
- [ ] Review and rebase or supersede the existing dependency update against the v3 toolchain, without blindly repeating the dependency compatibility work completed in 2.2.0.
- [ ] Keep CI scopes and timeouts sufficient for the new checks, and avoid an unnecessarily large Cartesian product when targeted compatibility jobs provide the required evidence.

### B4. Documentation and migration

- [ ] Add a tested `CursorTransformer` example using the final option name and validation contract.
- [ ] Document `noTotalCount`, its default, result shape and query-cost tradeoffs.
- [ ] Document unique ordering, NULL handling, supported values/precision, query ownership, raw mode, flags, errors and consistency limits.
- [ ] Correct the README example whose equal-name IDs are shown ascending despite descending ID ordering.
- [ ] Execute or otherwise verify the documented import and pagination examples against built artifacts.
- [ ] Add a v2-to-v3 migration guide covering exports, options, types, supported runtimes, deep imports and old cursor invalidation/restart.
- [ ] Keep the README linked to this backlog instead of duplicating task lists.

Acceptance for B: a packed v3 release candidate installs and works in all documented consumer forms; its types, runtime exports, examples and published file list agree.
