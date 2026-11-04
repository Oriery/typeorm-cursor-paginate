import {
  Column,
  DataSource,
  Entity,
  PrimaryColumn,
  type Logger,
  type SelectQueryBuilder,
} from "typeorm";
import {
  CursorPaginator,
  type CursorPaginatorPaginateParams,
} from "./cursor-paginator";
import { paginate, paginateRaw } from "./paginate";

@Entity()
class AvailabilityRecord {
  @PrimaryColumn("integer")
  id!: number;

  @Column("integer")
  ownerId!: number;

  @Column("text")
  label!: string;
}

type Mode = "entity" | "raw";
type Options = CursorPaginatorPaginateParams;
type Page = {
  nodes: unknown[];
  totalCount: number | null;
  hasPrevPage: boolean | null;
  hasNextPage: boolean | null;
  prevPageCursor: string | null;
  nextPageCursor: string | null;
};

describe("optional opposite-page availability on SQLite", () => {
  let source: DataSource;
  const statements: string[] = [];
  const logger: Logger = {
    logQuery: (sql) => statements.push(sql),
    logQueryError: () => undefined,
    logQuerySlow: () => undefined,
    logSchemaBuild: () => undefined,
    logMigration: () => undefined,
    log: () => undefined,
  };
  const paginator = new CursorPaginator(AvailabilityRecord, {
    orderBy: { id: "ASC" },
  });

  beforeAll(async () => {
    source = await new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [AvailabilityRecord],
      synchronize: true,
      logging: ["query"],
      logger,
    }).initialize();
  });

  beforeEach(async () => {
    const repo = source.getRepository(AvailabilityRecord);
    await repo.clear();
    await repo.insert([
      ...Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        ownerId: 1,
        label: `item-${i + 1}`,
      })),
      { id: 100, ownerId: 2, label: "other-owner" },
    ]);
    statements.length = 0;
  });

  afterAll(async () => {
    await source.destroy();
  });

  function query(mode: Mode) {
    const qb = source
      .getRepository(AvailabilityRecord)
      .createQueryBuilder("item")
      .where("item.ownerId = :ownerId", { ownerId: 1 });
    return mode === "raw"
      ? qb.select("item.id", "public_id")
      : qb.select("item.id");
  }

  function read(
    mode: Mode,
    qb: SelectQueryBuilder<AvailabilityRecord>,
    options: Options = {},
  ): Promise<Page> {
    return mode === "raw"
      ? paginator.paginateRaw<{ public_id: number }>(qb, options)
      : paginator.paginate(qb, options);
  }

  function nodes(mode: Mode, ids: number[]) {
    return ids.map((id) => (mode === "raw" ? { public_id: id } : { id }));
  }

  function expectNoProbe(expectedReads: number) {
    expect(statements).toHaveLength(expectedReads);
    expect(statements.some((sql) => /LIMIT 1\b/.test(sql))).toBe(false);
  }

  it.each([null, 0, "false"])(
    "rejects invalid checkOppositePage %p before SQL",
    async (value) => {
      const result: unknown = Reflect.apply(
        paginator.paginate.bind(paginator),
        paginator,
        [query("entity"), { checkOppositePage: value }],
      );
      await expect(result).rejects.toMatchObject({
        name: "PaginationInputError",
        code: "INVALID_OPTION",
      });
      expect(statements).toEqual([]);
    },
  );

  describe.each<Mode>(["entity", "raw"])("%s results", (mode) => {
    const pageReads = mode === "entity" ? 2 : 1;

    it("keeps cursorless flags known without issuing an opposite probe", async () => {
      const page = await read(mode, query(mode), {
        limit: 2,
        noTotalCount: true,
        checkOppositePage: false,
      });
      expect(page).toMatchObject({
        nodes: nodes(mode, [1, 2]),
        totalCount: null,
        hasPrevPage: false,
        hasNextPage: true,
      });
      expect(page.prevPageCursor).toEqual(expect.any(String));
      expect(page.nextPageCursor).toEqual(expect.any(String));
      expectNoProbe(pageReads);
    });

    it("skips exactly the forward opposite probe and preserves projections, cursors and caller state", async () => {
      const qb = query(mode);
      const original = qb.getQueryAndParameters();
      const parameters = qb.getParameters();
      const first = await read(mode, qb, { limit: 2, noTotalCount: true });
      const options = {
        limit: 2,
        pageCursor: first.nextPageCursor,
        noTotalCount: true,
      };
      statements.length = 0;
      const exact = await read(mode, qb, options);
      expect(statements).toHaveLength(pageReads + 1);
      expect(statements.filter((sql) => /LIMIT 1\b/.test(sql))).toHaveLength(1);
      expect(exact.hasPrevPage).toBe(true);

      statements.length = 0;
      const skipped = await read(mode, qb, {
        ...options,
        checkOppositePage: false,
      });
      expect(skipped).toEqual({ ...exact, hasPrevPage: null });
      expect(skipped.nodes).toEqual(nodes(mode, [3, 4]));
      expectNoProbe(pageReads);
      expect(qb.getQueryAndParameters()).toEqual(original);
      expect(qb.getParameters()).toEqual(parameters);

      statements.length = 0;
      expect(
        await read(mode, qb, { ...options, checkOppositePage: true }),
      ).toEqual(exact);
      expect(statements).toHaveLength(pageReads + 1);
    });

    it("skips the backward opposite probe while keeping requested-direction lookahead", async () => {
      const qb = query(mode);
      const first = await read(mode, qb, { limit: 4, noTotalCount: true });
      const final = await read(mode, qb, {
        limit: 2,
        pageCursor: first.nextPageCursor,
        noTotalCount: true,
      });
      const options = {
        limit: 2,
        pageCursor: final.prevPageCursor,
        noTotalCount: true,
      };
      const exact = await read(mode, qb, options);
      expect(exact).toMatchObject({
        nodes: nodes(mode, [3, 4]),
        hasPrevPage: true,
        hasNextPage: true,
      });
      statements.length = 0;
      const skipped = await read(mode, qb, {
        ...options,
        checkOppositePage: false,
      });
      expect(skipped).toEqual({ ...exact, hasNextPage: null });
      expectNoProbe(pageReads);
    });

    it("keeps total counting independent of skipping the opposite probe", async () => {
      const qb = query(mode);
      const first = await read(mode, qb, { limit: 2, noTotalCount: true });
      statements.length = 0;
      const page = await read(mode, qb, {
        limit: 2,
        pageCursor: first.nextPageCursor,
        checkOppositePage: false,
      });
      expect(page).toMatchObject({
        totalCount: 6,
        hasPrevPage: null,
        hasNextPage: true,
      });
      expectNoProbe(pageReads + 1);
      expect(statements.filter((sql) => /COUNT\s*\(/i.test(sql))).toHaveLength(
        1,
      );
    });

    it.each(["forward", "backward"] as const)(
      "reports unknown on an empty %s cursor page without probing",
      async (direction) => {
        const qb = query(mode);
        const all = await read(mode, qb, { noTotalCount: true });
        statements.length = 0;
        const page = await read(mode, qb, {
          limit: 2,
          pageCursor:
            direction === "forward" ? all.nextPageCursor : all.prevPageCursor,
          noTotalCount: true,
          checkOppositePage: false,
        });
        expect(page).toEqual({
          nodes: [],
          totalCount: null,
          hasPrevPage: direction === "forward" ? null : false,
          hasNextPage: direction === "forward" ? false : null,
          prevPageCursor: null,
          nextPageCursor: null,
        });
        expectNoProbe(1);
      },
    );

    it("keeps both flags false for an empty cursorless query", async () => {
      const qb = query(mode).andWhere("item.id < :minimum", { minimum: 0 });
      const page = await read(mode, qb, {
        limit: 2,
        noTotalCount: true,
        checkOppositePage: false,
      });
      expect(page).toEqual({
        nodes: [],
        totalCount: null,
        hasPrevPage: false,
        hasNextPage: false,
        prevPageCursor: null,
        nextPageCursor: null,
      });
      expectNoProbe(1);
    });

    it("does not turn an omitted probe into false after opposite rows are deleted", async () => {
      const qb = query(mode);
      const first = await read(mode, qb, { limit: 2, noTotalCount: true });
      await source.getRepository(AvailabilityRecord).delete([1, 2]);
      const options = {
        limit: 2,
        pageCursor: first.nextPageCursor,
        noTotalCount: true,
      };
      const exact = await read(mode, qb, options);
      expect(exact.hasPrevPage).toBe(false);
      statements.length = 0;
      const skipped = await read(mode, qb, {
        ...options,
        checkOppositePage: false,
      });
      expect(skipped).toEqual({ ...exact, hasPrevPage: null });
      expectNoProbe(pageReads);
    });

    it.each(["forward", "backward"] as const)(
      "keeps unlimited %s requested-direction availability false",
      async (direction) => {
        const qb = query(mode);
        const first = await read(mode, qb, { limit: 2, noTotalCount: true });
        const middle = await read(mode, qb, {
          limit: 2,
          pageCursor: first.nextPageCursor,
          noTotalCount: true,
        });
        statements.length = 0;
        const page = await read(mode, qb, {
          pageCursor:
            direction === "forward"
              ? first.nextPageCursor
              : middle.prevPageCursor,
          noTotalCount: true,
          checkOppositePage: false,
        });
        expect(page).toMatchObject({
          nodes: nodes(mode, direction === "forward" ? [3, 4, 5, 6] : [1, 2]),
          hasPrevPage: direction === "forward" ? null : false,
          hasNextPage: direction === "forward" ? false : null,
        });
        expectNoProbe(pageReads);
      },
    );
  });

  it.each<Mode>(["entity", "raw"])(
    "forwards the option through the standalone %s API",
    async (mode) => {
      const qb = query(mode);
      const first = await read(mode, qb, { limit: 2, noTotalCount: true });
      const options = {
        orderBy: { id: "ASC" as const },
        limit: 2,
        pageCursor: first.nextPageCursor,
        noTotalCount: true,
        checkOppositePage: false,
      };
      statements.length = 0;
      const page =
        mode === "raw"
          ? await paginateRaw<{ public_id: number }, AvailabilityRecord>(
              AvailabilityRecord,
              qb,
              options,
            )
          : await paginate(AvailabilityRecord, qb, options);
      expect(page).toMatchObject({
        nodes: nodes(mode, [3, 4]),
        totalCount: null,
        hasPrevPage: null,
        hasNextPage: true,
      });
      expectNoProbe(mode === "entity" ? 2 : 1);
    },
  );
});
