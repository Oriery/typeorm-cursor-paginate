# Contributing

For installation and application examples, start with the [README](README.md). This guide covers changes to the package, its documentation, and its release artifacts.

## Set up the repository

Use Node 24.11 or newer within 24.x and npm 11 for the reference development environment. The lockfile supplies the compiler, test tools, TypeORM, and database drivers. Docker is needed for the default PostgreSQL test harness.

```sh
npm ci
npm run check
```

The complete check runs lint, formatting, TypeScript, SQLite and PostgreSQL tests, then builds and verifies an installed package. A passing SQLite suite alone does not establish the PostgreSQL timestamp and precision contracts.

## Make a change

For a bug fix, first reduce the failure to a small entity and query that can run independently. Add a regression that fails before the fix and checks the observable result: ordered traversal, preserved filters, complete joined collections, or the expected error. Use real database fixtures where the behavior depends on SQL, driver values, or TypeORM hydration.

Keep examples and reproductions self-contained. A useful bug report includes the package, Node, TypeORM and driver versions; entity definitions; a query and fixture rows; and the expected and actual result. Remove credentials and private data before sharing a reproduction.

Update the documentation that owns the behavior: practical examples in the [usage guide](docs/usage.md), precise guarantees and limitations in the [core contract](docs/core-contract.md), and breaking changes in [MIGRATION.md](MIGRATION.md). Record user-visible changes in [CHANGELOG.md](CHANGELOG.md). Explain the reason for a deliberate limitation rather than implying that every TypeORM query is supported.

## Run focused checks

| Command                 | What it checks                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`     | SQLite behavior and input validation through Jest.                                                                |
| `npm run test:postgres` | PostgreSQL behavior, timezones and exact database values.                                                         |
| `npm run typecheck`     | Source and test TypeScript types without emitting files.                                                          |
| `npm run test:lint`     | ESLint rules, including warnings.                                                                                 |
| `npm run test:format`   | Repository formatting; `npm run format` applies it.                                                               |
| `npm run test:package`  | Reproducible tarball, package contents, installed entry points, declaration consumers and documentation examples. |
| `npm run build`         | Production JavaScript and declarations in `lib/`.                                                                 |

`npm test` combines lint, formatting and the ordinary Jest suite. Without a configured PostgreSQL URL, that suite skips PostgreSQL cases; use `npm run test:postgres` or the complete `npm run check` to include them.

### PostgreSQL fixtures

By default, `test:postgres` starts a disposable PostgreSQL 18 Docker container and removes it afterward. It runs the tests under a different process timezone from the database sessions to expose timezone-dependent behavior.

To use an existing test server, set `PAGINATOR_POSTGRES_URL` to a login with `CREATE DATABASE` permission. The suite creates a uniquely named database and drops it afterward; it does not reuse the server's application data.

### Installed consumers

`test:package` builds and packs twice, verifies identical tarballs and the explicit production-file allowlist, then installs the artifact in a fresh temporary project. The consumer exercises CommonJS, native ESM, shared constructor identity, TypeScript resolution and declaration emission, and the runnable documentation examples. These checks use the installed files, so they can catch export or packaging errors that source imports would miss.

When moving an executable example between documents, update its extraction in `scripts/test-package.cjs`. Keep the example checked against the public entry point. When adding a shipped document, update both the manifest's `files` list and the package check's document allowlist.

Set `PACKAGE_KEEP_TMP=1` to retain the temporary consumer for investigation. A failing run retains it automatically and prints its path. `PACKAGE_TARBALL` selects an existing artifact instead of building one from the checkout.

## Check compatibility

The [CI matrix](.github/workflows/ci.yml) checks exact supported floors and current dependency branches on Node 24 and 26. Node 22 compatibility is checked during release preparation, including the 22.13.0 floor, but is not continuously tested in CI. The [README compatibility table](README.md#compatibility) is the public support policy.

Keep TypeORM and SQLite driver versions compatible: TypeORM 0.3.21 uses `better-sqlite3` 11.10.0 in the floor fixture; TypeORM 1.0.0 uses 12.11.1. Do not bypass incompatible peers with `--force` or `--legacy-peer-deps`.

The packed consumer can select exact dependency versions independently of the development checkout:

```sh
PACKAGE_TYPEORM_VERSION=0.3.21 \
PACKAGE_SQLITE_VERSION=11.10.0 \
PACKAGE_TYPESCRIPT_VERSION=5.7.3 \
npm run test:package
```

Run the command under the Node version being verified; dependency overrides do not change the runtime. `PACKAGE_NODE_TYPES_VERSION` can select the consumer's Node ambient types. TypeScript fixtures check declarations without `skipLibCheck`, including the `ESNext.Disposable` library required by TypeORM 1. Bundler resolution covers types for Node-targeted builds, not browser execution.

## Build output

Production compilation emits ES2022 CommonJS JavaScript and matching declarations, excluding tests. The native ESM entry point delegates to the same implementation so constructors and `instanceof` checks retain identity across imports. SWC transforms Jest tests only.

`lib/` and `artifacts/` are generated output and are not committed. Set `PACKAGE_OUTPUT_DIR=artifacts` when running `test:package` to keep the verified tarball for a separate consumer or release.

The exact `minimatch` and `glob` overrides address development-tool advisories until upstream dependency ranges accept patched versions. The remaining `deepmerge` advisory concerns Jest configuration merging and is tracked in [issue #20](https://github.com/Oriery/typeorm-cursor-paginate/issues/20); it is not a distributed runtime dependency.

## Release verification

Run `npm ci` and `npm run check` before publication.
The suite checks SQLite and real PostgreSQL, lint, formatting, types, reproducible tarballs, the production file allowlist, installed CJS/ESM consumers and executable README and usage-guide examples.
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
