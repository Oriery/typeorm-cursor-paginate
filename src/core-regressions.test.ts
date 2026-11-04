import {
  Column,
  DataSource,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type FindOptionsOrderValue,
  type Logger,
  type SelectQueryBuilder,
} from "typeorm";
import { CursorPaginator } from "./cursor-paginator";
import type { OrderBy, Paginated } from "./interfaces/paginator";

@Entity()
class CoreOwner {
  @PrimaryColumn({ type: Number })
  id!: number;

  @Column({ type: String })
  name!: string;
}

class CoreDetail {
  @Column({ type: String, name: "sort_label", nullable: true })
  label!: string | null;
}

@Entity()
class CoreRecord {
  @PrimaryColumn({ type: Number })
  id!: number;

  @Column({ type: String, name: "display_name", nullable: true })
  name!: string | null;

  @Column({ type: Number })
  rank!: number;

  @Column({ type: Number })
  ownerId!: number;

  @Column(() => CoreDetail)
  detail!: CoreDetail;

  @ManyToOne(() => CoreOwner)
  owner!: CoreOwner;

  @OneToMany(() => CoreChild, (child) => child.record)
  children!: CoreChild[];
}

@Entity()
class CoreChild {
  @PrimaryColumn({ type: Number })
  id!: number;

  @Column({ type: Number })
  recordId!: number;

  @ManyToOne(() => CoreRecord, (record) => record.children)
  record!: CoreRecord;
}

const queries: { sql: string; parameters: unknown[] }[] = [];
const logger: Logger = {
  logQuery: (sql, parameters) => {
    queries.push({ sql, parameters: parameters ?? [] });
  },
  logQueryError: () => undefined,
  logQuerySlow: () => undefined,
  logSchemaBuild: () => undefined,
  logMigration: () => undefined,
  log: () => undefined,
};

/** Asserts complete traversal rather than allowing a correct first page to hide skips. */
async function traverse(
  paginator: CursorPaginator<CoreRecord>,
  query: SelectQueryBuilder<CoreRecord>,
  expected: number[],
  limit = 2,
): Promise<void> {
  const original = query.getQueryAndParameters();
  const parameters = query.getParameters();
  const forward: number[] = [];
  let page: Paginated<CoreRecord> = await paginator.paginate(query, { limit });
  let visits = 0;
  for (;;) {
    expect(page.totalCount).toBe(expected.length);
    expect(page.nodes.length).toBeLessThanOrEqual(limit);
    forward.push(...page.nodes.map((node) => node.id));
    if (!page.hasNextPage) break;
    if (++visits > expected.length + 1)
      throw new Error("Traversal did not end");
    page = await paginator.paginate(query, {
      limit,
      pageCursor: page.nextPageCursor,
    });
  }
  expect(forward).toEqual(expected);
  const backward = page.nodes.map((node) => node.id);
  visits = 0;
  while (page.hasPrevPage) {
    if (++visits > expected.length + 1)
      throw new Error("Traversal did not end");
    page = await paginator.paginate(query, {
      limit,
      pageCursor: page.prevPageCursor,
    });
    expect(page.totalCount).toBe(expected.length);
    backward.unshift(...page.nodes.map((node) => node.id));
  }
  expect(backward).toEqual(expected);
  expect(query.getQueryAndParameters()).toEqual(original);
  expect(query.getParameters()).toEqual(parameters);
}

describe("v3 core regressions with SQLite", () => {
  let db: DataSource;
  const byId = () =>
    new CursorPaginator(CoreRecord, { orderBy: { id: "ASC" } });
  const query = () => db.getRepository(CoreRecord).createQueryBuilder("r");

  beforeAll(async () => {
    db = await new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [CoreRecord, CoreOwner, CoreChild],
      synchronize: true,
      logging: ["query"],
      logger,
    }).initialize();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.getRepository(CoreChild).clear();
    await db.getRepository(CoreRecord).clear();
    await db.getRepository(CoreOwner).clear();
    await db.getRepository(CoreOwner).save([
      { id: 1, name: "first" },
      { id: 2, name: "second" },
    ]);
    await db.getRepository(CoreRecord).save([
      { id: 1, name: null, rank: 2, ownerId: 1, detail: { label: "b" } },
      { id: 2, name: "a", rank: 2, ownerId: 1, detail: { label: "a" } },
      { id: 3, name: "a", rank: 1, ownerId: 1, detail: { label: "a" } },
      { id: 4, name: "b", rank: 1, ownerId: 1, detail: { label: "b" } },
      { id: 5, name: null, rank: 2, ownerId: 1, detail: { label: null } },
      { id: 6, name: "a", rank: 2, ownerId: 2, detail: { label: null } },
    ]);
    await db.getRepository(CoreChild).save([
      { id: 1, recordId: 1 },
      { id: 2, recordId: 1 },
      { id: 3, recordId: 1 },
      { id: 4, recordId: 2 },
      { id: 5, recordId: 4 },
    ]);
    queries.length = 0;
  });

  it("reuses a filtered query in both directions without changing SQL or parameters", async () => {
    await traverse(
      byId(),
      query().where("r.ownerId = :owner", { owner: 1 }),
      [1, 2, 3, 4, 5],
    );
  });

  it("isolates cursor parameters from a security filter, join and subquery", async () => {
    const qb = query()
      .innerJoin("r.owner", "o", "o.id = :cursor__id", { cursor__id: 1 })
      .where("r.ownerId = :cursor__id")
      .andWhere((subquery) => {
        const sql = subquery
          .subQuery()
          .select("candidate.id")
          .from(CoreRecord, "candidate")
          .where("candidate.ownerId = :__cursor_0", { __cursor_0: 1 })
          .getQuery();
        return `r.id IN ${sql}`;
      });
    const parameters = qb.getParameters();
    await traverse(byId(), qb, [1, 2, 3, 4, 5]);
    expect(qb.getParameters()).toEqual(parameters);
    expect(qb.getParameters().cursor__id).toBe(1);
    expect(qb.getParameters().__cursor_0).toBe(1);
  });

  it("groups pre-existing unbracketed OR predicates before the cursor", async () => {
    await traverse(
      byId(),
      query()
        .where("r.id = :first", { first: 1 })
        .orWhere("r.ownerId = :owner", { owner: 2 }),
      [1, 6],
      1,
    );
  });

  it.each([
    ["order", (qb: SelectQueryBuilder<CoreRecord>) => qb.orderBy("r.name")],
    ["take", (qb: SelectQueryBuilder<CoreRecord>) => qb.take(2)],
    ["skip", (qb: SelectQueryBuilder<CoreRecord>) => qb.skip(1)],
    ["limit", (qb: SelectQueryBuilder<CoreRecord>) => qb.limit(2)],
    ["offset", (qb: SelectQueryBuilder<CoreRecord>) => qb.offset(1)],
    ["group", (qb: SelectQueryBuilder<CoreRecord>) => qb.groupBy("r.id")],
    ["distinct", (qb: SelectQueryBuilder<CoreRecord>) => qb.distinct()],
    [
      "aggregate",
      (qb: SelectQueryBuilder<CoreRecord>) => qb.select("MAX(r.id)", "max"),
    ],
  ])(
    "rejects incompatible existing %s before SQL",
    async (_name, configure) => {
      const qb = configure(query());
      const original = qb.getQueryAndParameters();
      await expect(byId().paginate(qb, { limit: 2 })).rejects.toMatchObject({
        name: "PaginationInputError",
      });
      expect(queries).toHaveLength(0);
      expect(qb.getQueryAndParameters()).toEqual(original);
    },
  );

  it("rejects duplicate ordering keys at construction", () => {
    expect(
      () =>
        new CursorPaginator(CoreRecord, {
          orderBy: [{ id: "ASC" }, { id: "ASC" }],
        }),
    ).toThrow();
  });

  it("requires the complete root primary key in the ordering", async () => {
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: { name: "ASC" },
    });
    await expect(
      paginator.paginate(query(), { limit: 2 }),
    ).rejects.toMatchObject({
      name: "PaginationInputError",
    });
    expect(queries).toHaveLength(0);
  });

  it.each(["missing", "owner.name", "id); DROP TABLE core_record; --"])(
    "rejects unsupported ordering identifier %s before SQL",
    async (key) => {
      const paginator = new CursorPaginator(CoreRecord, {
        orderBy: { [key]: "ASC", id: "ASC" },
      });
      await expect(paginator.paginate(query())).rejects.toMatchObject({
        name: "PaginationInputError",
      });
      expect(queries).toHaveLength(0);
    },
  );

  const directions: [FindOptionsOrderValue, boolean][] = [
    ["ASC", true],
    ["asc", true],
    [1, true],
    ["DESC", false],
    ["desc", false],
    [-1, false],
    [{ direction: "ASC" }, true],
    [{ direction: "asc" }, true],
    [{ direction: 1 }, true],
    [{ direction: "DESC" }, false],
    [{ direction: "desc" }, false],
    [{ direction: -1 }, false],
  ];
  it.each(directions)(
    "traverses accepted direction %j and mixed-direction ties",
    async (direction, ascending) => {
      const paginator = new CursorPaginator(CoreRecord, {
        orderBy: { rank: direction, id: "DESC" } as OrderBy<CoreRecord>,
      });
      await traverse(
        paginator,
        query(),
        ascending ? [4, 3, 6, 5, 2, 1] : [6, 5, 2, 1, 4, 3],
      );
    },
  );

  it.each([
    ["ASC", "FIRST", [5, 1, 6, 3, 2, 4]],
    ["ASC", "LAST", [6, 3, 2, 4, 5, 1]],
    ["DESC", "FIRST", [5, 1, 4, 6, 3, 2]],
    ["DESC", "LAST", [4, 6, 3, 2, 5, 1]],
  ] as const)(
    "traverses nullable renamed columns %s NULLS %s in both directions",
    async (direction, nulls, expected) => {
      const paginator = new CursorPaginator(CoreRecord, {
        orderBy: {
          name: { direction, nulls },
          id: "DESC",
        } as OrderBy<CoreRecord>,
      });
      await traverse(paginator, query(), [...expected], 1);
    },
  );

  it("supports embedded property paths and renamed database columns", async () => {
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: {
        "detail.label": { direction: "ASC", nulls: "LAST" },
        id: "ASC",
      } as OrderBy<CoreRecord>,
    });
    await traverse(paginator, query(), [2, 3, 1, 4, 5, 6], 1);
  });

  it("keeps hostile string boundaries as bound data in composed queries", async () => {
    const hostile = "x' OR 1=1; DROP TABLE core_record; --";
    await db.getRepository(CoreRecord).update({ id: 2 }, { name: hostile });
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: { name: "ASC", id: "ASC" },
    });
    const qb = query()
      .where("r.name = :name", { name: hostile })
      .orWhere("r.id = :id", { id: 4 });
    queries.length = 0;
    await traverse(paginator, qb, [4, 2], 1);
    expect(queries.some(({ parameters }) => parameters.includes(hostile))).toBe(
      true,
    );
    expect(queries.every(({ sql }) => !sql.includes(hostile))).toBe(true);
    expect(await db.getRepository(CoreRecord).count()).toBe(6);
  });

  it("limits root entities without truncating hydrated to-many relations", async () => {
    const qb = query().leftJoinAndSelect("r.children", "children");
    const page = await byId().paginate(qb, { limit: 1 });
    expect(page.totalCount).toBe(6);
    expect(page.nodes.map((node) => node.id)).toEqual([1]);
    expect(page.nodes[0].children.map((child) => child.id).sort()).toEqual([
      1, 2, 3,
    ]);
    await traverse(byId(), qb, [1, 2, 3, 4, 5, 6], 1);
  });

  it("obtains omitted boundary columns without exposing them in partial entity results", async () => {
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: { rank: "ASC", id: "DESC" },
    });
    const qb = query().select(["r.id"]);
    const page = await paginator.paginate(qb, { limit: 2 });
    expect(page.nodes.map((node) => ({ ...node }))).toEqual([
      { id: 4 },
      { id: 3 },
    ]);
    await traverse(paginator, qb, [4, 3, 6, 5, 2, 1]);
    expect(qb.expressionMap.selects).toEqual([{ selection: "r.id" }]);
  });

  it("supports raw default and custom aliases with omitted boundary selections", async () => {
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: { rank: "ASC", id: "DESC" },
    });
    const qb = query()
      .select("r.id", "record_key")
      .addSelect("r.name", "label");
    const original = qb.getQueryAndParameters();
    const ids: number[] = [];
    let cursor: string | null = null;
    let last: Paginated<{ record_key: number; label: string | null }>;
    do {
      last = await paginator.paginateRaw<{
        record_key: number;
        label: string | null;
      }>(qb, { limit: 2, pageCursor: cursor });
      expect(last.totalCount).toBe(6);
      expect(
        last.nodes.every(
          (node) => Object.keys(node).sort().join() === "label,record_key",
        ),
      ).toBe(true);
      ids.push(...last.nodes.map((node) => node.record_key));
      cursor = last.nextPageCursor;
    } while (last.hasNextPage);
    expect(ids).toEqual([4, 3, 6, 5, 2, 1]);
    const previous = await paginator.paginateRaw<{
      record_key: number;
      label: string | null;
    }>(qb, { limit: 2, pageCursor: last.prevPageCursor });
    expect(previous.nodes.map((node) => node.record_key)).toEqual([6, 5]);
    expect(qb.getQueryAndParameters()).toEqual(original);
    const defaults = await byId().paginateRaw<{ r_id: number }>(query(), {
      limit: 1,
    });
    expect(defaults.nodes[0].r_id).toBe(1);
    const second = await byId().paginateRaw<{ r_id: number }>(query(), {
      limit: 1,
      pageCursor: defaults.nextPageCursor,
    });
    expect(second.nodes[0].r_id).toBe(2);
  });

  it("enforces joined raw limits for to-one joins and counts root records", async () => {
    const qb = query().leftJoinAndSelect("r.owner", "o");
    const first = await byId().paginateRaw<{ r_id: number; o_id: number }>(qb, {
      limit: 2,
    });
    expect(first.nodes.map((node) => node.r_id)).toEqual([1, 2]);
    expect(first.nodes.every((node) => node.o_id === 1)).toBe(true);
    expect(first.totalCount).toBe(6);
    expect(first.hasNextPage).toBe(true);
    const second = await byId().paginateRaw<{ r_id: number }>(qb, {
      limit: 2,
      pageCursor: first.nextPageCursor,
    });
    expect(second.nodes.map((node) => node.r_id)).toEqual([3, 4]);
    const back = await byId().paginateRaw<{ r_id: number }>(qb, {
      limit: 2,
      pageCursor: second.prevPageCursor,
    });
    expect(back.nodes.map((node) => node.r_id)).toEqual([1, 2]);
  });

  it("rejects multiplying raw joins before SQL instead of claiming a raw-row limit", async () => {
    const qb = query().leftJoinAndSelect("r.children", "children");
    await expect(byId().paginateRaw(qb, { limit: 2 })).rejects.toMatchObject({
      name: "PaginationInputError",
    });
    expect(queries).toHaveLength(0);
  });

  it("reports no previous page after all earlier records and the boundary are deleted", async () => {
    const first = await byId().paginate(query(), { limit: 3 });
    await db.getRepository(CoreChild).clear();
    await db.getRepository(CoreRecord).delete([1, 2, 3]);
    const page = await byId().paginate(query(), {
      limit: 2,
      pageCursor: first.nextPageCursor,
    });
    expect(page.nodes.map((node) => node.id)).toEqual([4, 5]);
    expect(page.hasPrevPage).toBe(false);
    expect(page.hasNextPage).toBe(true);
    expect(page.prevPageCursor).toEqual(expect.any(String));
  });

  it("reports no next page after all later records and the backward boundary are deleted", async () => {
    const first = await byId().paginate(query(), { limit: 3 });
    const last = await byId().paginate(query(), {
      limit: 3,
      pageCursor: first.nextPageCursor,
    });
    await db.getRepository(CoreChild).clear();
    await db.getRepository(CoreRecord).delete([4, 5, 6]);
    const page = await byId().paginate(query(), {
      limit: 2,
      pageCursor: last.prevPageCursor,
    });
    expect(page.nodes.map((node) => node.id)).toEqual([2, 3]);
    expect(page.hasPrevPage).toBe(true);
    expect(page.hasNextPage).toBe(false);
    expect(page.nextPageCursor).toEqual(expect.any(String));
  });

  it("continues traversal when only the boundary row is deleted", async () => {
    const first = await byId().paginate(query(), { limit: 3 });
    await db.getRepository(CoreChild).delete({ recordId: 3 });
    await db.getRepository(CoreRecord).delete(3);
    const page = await byId().paginate(query(), {
      limit: 2,
      pageCursor: first.nextPageCursor,
    });
    expect(page.nodes.map((node) => node.id)).toEqual([4, 5]);
    expect(page.hasPrevPage).toBe(true);
  });

  it("suppresses count queries independently of accurate flags", async () => {
    const first = await byId().paginate(query(), {
      limit: 3,
      noTotalCount: true,
    });
    await db.getRepository(CoreChild).clear();
    await db.getRepository(CoreRecord).delete([1, 2, 3]);
    queries.length = 0;
    const page = await byId().paginate(query(), {
      limit: 2,
      pageCursor: first.nextPageCursor,
      noTotalCount: true,
    });
    expect(page.totalCount).toBeNull();
    expect(page.hasPrevPage).toBe(false);
    expect(page.hasNextPage).toBe(true);
    expect(queries.every(({ sql }) => !/\bCOUNT\s*\(/i.test(sql))).toBe(true);
    expect(queries.length).toBeLessThanOrEqual(4);
  });

  it("defines empty-page flags relative to the cursor boundary, including the boundary row", async () => {
    const all = await byId().paginate(query());
    const after = await byId().paginate(query(), {
      limit: 2,
      pageCursor: all.nextPageCursor,
    });
    expect(after).toMatchObject({
      nodes: [],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: null,
      nextPageCursor: null,
    });
    const before = await byId().paginate(query(), {
      limit: 2,
      pageCursor: all.prevPageCursor,
    });
    expect(before).toMatchObject({
      nodes: [],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: null,
      nextPageCursor: null,
    });
    await db.getRepository(CoreChild).clear();
    await db.getRepository(CoreRecord).clear();
    const deleted = await byId().paginate(query(), {
      limit: 2,
      pageCursor: all.nextPageCursor,
    });
    expect(deleted).toMatchObject({
      nodes: [],
      hasPrevPage: false,
      hasNextPage: false,
      prevPageCursor: null,
      nextPageCursor: null,
    });
  });

  it("observes inserted rows between page reads without changing a stored boundary", async () => {
    const first = await byId().paginate(query(), { limit: 2 });
    await db
      .getRepository(CoreRecord)
      .save({ id: 7, name: "c", rank: 2, ownerId: 1, detail: { label: "c" } });
    const next = await byId().paginate(query(), {
      pageCursor: first.nextPageCursor,
    });
    expect(next.nodes.map((node) => node.id)).toEqual([3, 4, 5, 6, 7]);
    expect(next.totalCount).toBe(7);
    expect(next.hasPrevPage).toBe(true);
  });

  it("returns null cursors and false flags for an empty filtered dataset", async () => {
    const page = await byId().paginate(query().where("r.id < 0"), { limit: 2 });
    expect(page).toEqual({
      nodes: [],
      totalCount: 0,
      hasPrevPage: false,
      hasNextPage: false,
      prevPageCursor: null,
      nextPageCursor: null,
    });
    const raw = await byId().paginateRaw(query().where("r.id < 0"), {
      limit: 2,
    });
    expect(raw).toEqual(page);
  });
});
