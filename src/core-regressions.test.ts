import {
  Column,
  DataSource,
  Entity,
  EntitySchema,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type FindOptionsOrderValue,
  type Logger,
  type SelectQueryBuilder,
} from "typeorm";
import { CursorPaginator } from "./cursor-paginator";
import type { Paginated } from "./interfaces/paginator";

@Entity()
class CoreOwner {
  @PrimaryColumn({ type: Number })
  id!: number;

  @Column({ type: String })
  name!: string;

  @OneToMany(() => CoreTextKey, (item) => item.owner)
  textKeys!: CoreTextKey[];
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

  @Column({ type: String, select: false, default: "hidden-boundary" })
  hidden!: string;

  @Column({ type: Number })
  ownerId!: number;

  @Column(() => CoreDetail)
  detail!: CoreDetail;

  @ManyToOne(() => CoreOwner)
  owner!: CoreOwner;

  @OneToMany(() => CoreChild, (child) => child.record)
  children!: CoreChild[];

  displayOwner?: CoreOwner | null;
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

@Entity()
class CoreComposite {
  @PrimaryColumn({ type: Number })
  tenantId!: number;

  @PrimaryColumn({ type: Number })
  id!: number;

  @Column({ type: String })
  label!: string;
}

@Entity()
class CoreTextKey {
  @Column({ type: Number, default: 1 })
  ownerId!: number;

  @ManyToOne(() => CoreOwner)
  owner!: CoreOwner;

  @PrimaryColumn({ type: String })
  scope!: string;

  @PrimaryColumn({ type: String })
  key!: string;

  @Column({ type: String })
  label!: string;
}

class CoreIdentity {
  @PrimaryColumn({ type: Number })
  tenant!: number;

  @PrimaryColumn({ type: Number })
  id!: number;
}

@Entity()
class CoreEmbeddedKey {
  @Column(() => CoreIdentity)
  identity!: CoreIdentity;

  @Column({ type: String })
  label!: string;
}

const queries: { sql: string; parameters: unknown[] }[] = [];
const logger: Logger = {
  logQuery: (sql, parameters) => {
    queries.push({
      sql,
      parameters: Array.isArray(parameters) ? parameters : [],
    });
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
      entities: [
        CoreRecord,
        CoreOwner,
        CoreChild,
        CoreComposite,
        CoreTextKey,
        CoreEmbeddedKey,
      ],
      synchronize: true,
      logging: ["query"],
      logger,
    }).initialize();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.getRepository(CoreComposite).clear();
    await db.getRepository(CoreTextKey).clear();
    await db.getRepository(CoreEmbeddedKey).clear();
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
      .andWhere("r.ownerId = :__paginator_0", { __paginator_0: 1 })
      .andWhere("r.ownerId = :__paginator_1", { __paginator_1: 1 })
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
    [{}, true],
    [{ nulls: "first" }, true],
    [{ direction: "ASC" }, true],
    [{ direction: "asc" }, true],
    [{ direction: "DESC" }, false],
    [{ direction: "desc" }, false],
  ];
  it.each(directions)(
    "traverses accepted direction %j and mixed-direction ties",
    async (direction, ascending) => {
      const paginator = new CursorPaginator(CoreRecord, {
        orderBy: { rank: direction, id: "DESC" },
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
    ["asc", "first", [5, 1, 6, 3, 2, 4]],
    ["desc", "last", [4, 6, 3, 2, 5, 1]],
  ] as const)(
    "traverses nullable renamed columns %s NULLS %s in both directions",
    async (direction, nulls, expected) => {
      const paginator = new CursorPaginator(CoreRecord, {
        orderBy: {
          name: { direction, nulls },
          id: "DESC",
        },
      });
      await traverse(paginator, query(), [...expected], 1);
    },
  );

  it("supports embedded property paths and renamed database columns", async () => {
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: {
        "detail.label": { direction: "ASC", nulls: "LAST" },
        id: "ASC",
      },
    });
    await traverse(paginator, query(), [2, 3, 1, 4, 5, 6], 1);
  });

  it("requires every composite primary column and traverses a complete unique tuple", async () => {
    const repo = db.getRepository(CoreComposite);
    await repo.save([
      { tenantId: 1, id: 1, label: "same" },
      { tenantId: 1, id: 2, label: "same" },
      { tenantId: 2, id: 1, label: "same" },
      { tenantId: 2, id: 2, label: "same" },
    ]);
    const qb = repo.createQueryBuilder("composite");
    queries.length = 0;
    const incomplete = new CursorPaginator(CoreComposite, {
      orderBy: { id: "ASC" },
    });
    await expect(incomplete.paginate(qb, { limit: 1 })).rejects.toMatchObject({
      name: "PaginationInputError",
    });
    expect(queries).toHaveLength(0);
    const paginator = new CursorPaginator(CoreComposite, {
      orderBy: { label: "ASC", tenantId: "ASC", id: "DESC" },
    });
    const identify = (node: CoreComposite) => `${node.tenantId}:${node.id}`;
    const forward: string[] = [];
    let page = await paginator.paginate(qb, { limit: 1 });
    let visits = 0;
    for (;;) {
      forward.push(...page.nodes.map(identify));
      if (!page.hasNextPage) break;
      if (++visits > 4) throw new Error("Composite traversal did not end");
      page = await paginator.paginate(qb, {
        limit: 1,
        pageCursor: page.nextPageCursor,
      });
    }
    expect(forward).toEqual(["1:2", "1:1", "2:2", "2:1"]);
    const backward = page.nodes.map(identify);
    while (page.hasPrevPage) {
      if (++visits > 8) throw new Error("Composite traversal did not end");
      page = await paginator.paginate(qb, {
        limit: 1,
        pageCursor: page.prevPageCursor,
      });
      backward.unshift(...page.nodes.map(identify));
    }
    expect(backward).toEqual(forward);
  });

  it("does not conflate composite text identities containing TypeORM's hydration separator", async () => {
    const repo = db.getRepository(CoreTextKey);
    await repo.save([
      { scope: "a_b", key: "c", label: "first" },
      { scope: "a", key: "b_c", label: "second" },
      { scope: "z", key: "last", label: "last" },
    ]);
    const qb = repo.createQueryBuilder("item");
    const paginator = new CursorPaginator(CoreTextKey, {
      orderBy: { scope: "ASC", key: "ASC" },
    });
    const first = await paginator.paginate(qb, { limit: 2 });
    expect(first.totalCount).toBe(3);
    expect(first.nodes.map(({ scope, key }) => [scope, key])).toEqual([
      ["a", "b_c"],
      ["a_b", "c"],
    ]);
    const last = await paginator.paginate(qb, {
      limit: 2,
      pageCursor: first.nextPageCursor,
    });
    expect(last.nodes.map(({ scope, key }) => [scope, key])).toEqual([
      ["z", "last"],
    ]);
    const back = await paginator.paginate(qb, {
      limit: 2,
      pageCursor: last.prevPageCursor,
    });
    expect(back.nodes).toEqual(first.nodes);
  });

  it("counts composite text identities without concatenation collisions", async () => {
    const repo = db.getRepository(CoreTextKey);
    await repo.save([
      { scope: "a|;|b", key: "c", label: "first" },
      { scope: "a", key: "b|;|c", label: "second" },
    ]);
    const paginator = new CursorPaginator(CoreTextKey, {
      orderBy: { scope: "ASC", key: "ASC" },
    });
    const qb = repo
      .createQueryBuilder("item")
      .leftJoinAndSelect("item.owner", "owner");
    const entity = await paginator.paginate(qb, { limit: 2 });
    const raw = await paginator.paginateRaw(qb, { limit: 2 });
    expect(entity.totalCount).toBe(2);
    expect(raw.totalCount).toBe(2);
    expect(entity.nodes).toHaveLength(2);
  });

  it("removes private embedded PK containers from partial projections", async () => {
    const repo = db.getRepository(CoreEmbeddedKey);
    await repo.save([
      { identity: { tenant: 1, id: 1 }, label: "first" },
      { identity: { tenant: 1, id: 2 }, label: "second" },
    ]);
    const paginator = new CursorPaginator(CoreEmbeddedKey, {
      orderBy: { "identity.tenant": "ASC", "identity.id": "ASC" },
    });
    const qb = repo.createQueryBuilder("item").select("item.label");
    const first = await paginator.paginate(qb, { limit: 1 });
    expect(
      first.nodes.map((node) => JSON.parse(JSON.stringify(node)) as unknown),
    ).toStrictEqual([{ label: "first" }]);
    const second = await paginator.paginate(qb, {
      limit: 1,
      pageCursor: first.nextPageCursor,
    });
    expect(
      second.nodes.map((node) => JSON.parse(JSON.stringify(node)) as unknown),
    ).toStrictEqual([{ label: "second" }]);
  });

  it("hydrates more than one thousand roots in explicit unlimited mode", async () => {
    const added = Array.from({ length: 1100 }, (_, index) => ({
      id: 100 + index,
      name: "bulk",
      rank: index % 3,
      ownerId: 1,
      detail: { label: "bulk" },
    }));
    for (let index = 0; index < added.length; index += 200) {
      await db
        .getRepository(CoreRecord)
        .insert(added.slice(index, index + 200));
    }
    const expected = [1, 2, 3, 4, 5, 6, ...added.map((node) => node.id)];
    const qb = query();
    const original = qb.getQueryAndParameters();
    const all = await byId().paginate(qb);
    expect(all.nodes.map((node) => node.id)).toEqual(expected);
    expect(all.totalCount).toBe(expected.length);
    expect(all.hasPrevPage).toBe(false);
    expect(all.hasNextPage).toBe(false);
    const limited = await byId().paginate(qb, { limit: 1050 });
    expect(limited.nodes.map((node) => node.id)).toEqual(
      expected.slice(0, 1050),
    );
    const last = await byId().paginate(qb, {
      pageCursor: limited.nextPageCursor,
    });
    const backward = await byId().paginate(qb, {
      pageCursor: last.prevPageCursor,
    });
    expect(backward.nodes.map((node) => node.id)).toEqual(
      expected.slice(0, 1050),
    );
    expect(qb.getQueryAndParameters()).toEqual(original);
  });

  it.each(["whole alias", "direct columns"])(
    "rejects selected composite-text-key relations using %s before querying",
    async (selection) => {
      await db.getRepository(CoreTextKey).save([
        { scope: "a_b", key: "c", label: "first" },
        { scope: "a", key: "b_c", label: "second" },
      ]);
      const qb = db.getRepository(CoreOwner).createQueryBuilder("owner");
      if (selection === "whole alias") {
        qb.leftJoinAndSelect("owner.textKeys", "item");
      } else {
        qb.leftJoin("owner.textKeys", "item").addSelect([
          "item.scope",
          "item.key",
          "item.label",
        ]);
      }
      const original = qb.getQueryAndParameters();
      const paginator = new CursorPaginator(CoreOwner, {
        orderBy: { id: "ASC" },
      });
      queries.length = 0;
      await expect(paginator.paginate(qb, { limit: 2 })).rejects.toMatchObject({
        name: "PaginationInputError",
        code: "UNSUPPORTED_QUERY",
      });
      expect(queries).toHaveLength(0);
      expect(qb.getQueryAndParameters()).toEqual(original);
    },
  );

  it("preserves scoped mapped-one joins through complete entity traversal", async () => {
    const qb = query().leftJoinAndMapOne(
      "r.displayOwner",
      CoreOwner,
      "displayOwner",
      "displayOwner.id = r.ownerId AND displayOwner.id = :visibleOwner",
      { visibleOwner: 1 },
    );
    await traverse(byId(), qb, [1, 2, 3, 4, 5, 6]);
    const first = await byId().paginate(qb, { limit: 5 });
    expect(first.nodes.every((node) => node.displayOwner?.id === 1)).toBe(true);
    const last = await byId().paginate(qb, {
      limit: 5,
      pageCursor: first.nextPageCursor,
    });
    expect(last.nodes[0].displayOwner).toBeNull();
    expect(last.totalCount).toBe(6);
    queries.length = 0;
    await expect(byId().paginateRaw(qb, { limit: 2 })).rejects.toMatchObject({
      code: "UNSUPPORTED_QUERY",
    });
    expect(queries).toHaveLength(0);
  });

  it.each([
    ["integer", false],
    ["integer", true],
    ["bigint", false],
    ["bigint", true],
  ] as const)(
    "rejects unsafe SQLite %s joined identities (composite: %s)",
    async (type, composite) => {
      class Parent {
        id!: number;
        children!: Child[];
      }
      class Child {
        id!: number;
        label!: string;
        parentId!: number;
        parent!: Parent;
      }
      const isolated = await new DataSource({
        type: "better-sqlite3",
        database: ":memory:",
        synchronize: true,
        entities: [
          new EntitySchema<Parent>({
            name: "Parent",
            target: Parent,
            columns: { id: { type: "integer", primary: true } },
            relations: {
              children: {
                type: "one-to-many",
                target: "Child",
                inverseSide: "parent",
              },
            },
          }),
          new EntitySchema<Child>({
            name: "Child",
            target: Child,
            columns: {
              id: { type, primary: true },
              label: { type: "varchar", primary: composite },
              parentId: { type: "integer" },
            },
            relations: {
              parent: {
                type: "many-to-one",
                target: "Parent",
                joinColumn: { name: "parentId" },
              },
            },
          }),
        ],
      }).initialize();
      try {
        await isolated.query("INSERT INTO parent VALUES (1)");
        await isolated.query(
          "INSERT INTO child VALUES (1, 'label', 1), (2, 'label', 1)",
        );
        const qb = isolated
          .getRepository(Parent)
          .createQueryBuilder("parent")
          .leftJoinAndSelect("parent.children", "child");
        const paginator = new CursorPaginator(Parent, {
          orderBy: { id: "ASC" },
        });
        expect(
          (await paginator.paginate(qb, { limit: 1 })).nodes[0].children,
        ).toHaveLength(2);
        await isolated.query("DELETE FROM child");
        await isolated.query(
          "INSERT INTO child VALUES (9007199254740992, 'label', 1), (9007199254740993, 'label', 1)",
        );
        expect(
          await isolated.query(
            "SELECT CAST(id AS text) AS id FROM child ORDER BY id",
          ),
        ).toEqual([{ id: "9007199254740992" }, { id: "9007199254740993" }]);
        const before = qb.getQueryAndParameters();
        await expect(
          paginator.paginate(qb, { limit: 1 }),
        ).rejects.toMatchObject({ code: "UNSUPPORTED_VALUE" });
        expect(qb.getQueryAndParameters()).toEqual(before);
      } finally {
        await isolated.destroy();
      }
    },
  );

  it("allows composite-text-key relations used only as filters", async () => {
    await db.getRepository(CoreTextKey).save([
      { scope: "a_b", key: "c", label: "first" },
      { scope: "a", key: "b_c", label: "second" },
    ]);
    const qb = db
      .getRepository(CoreOwner)
      .createQueryBuilder("owner")
      .innerJoin("owner.textKeys", "item");
    const paginator = new CursorPaginator(CoreOwner, {
      orderBy: { id: "ASC" },
    });
    const page = await paginator.paginate(qb, { limit: 1 });
    expect(page.nodes.map((node) => node.id)).toEqual([1]);
    expect(page.totalCount).toBe(1);
    expect(page.hasNextPage).toBe(false);
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

  it("keeps mixed NULL ordering when hydrating joined roots in both directions", async () => {
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: { name: { direction: "ASC", nulls: "LAST" }, id: "DESC" },
    });
    const qb = query().leftJoinAndSelect("r.children", "children");
    await traverse(paginator, qb, [6, 3, 2, 4, 5, 1]);
    const all = await paginator.paginate(qb);
    expect(all.nodes[5].children.map((child) => child.id).sort()).toEqual([
      1, 2, 3,
    ]);
  });

  it("bounds root-key and availability reads while preserving necessary joined fan-out", async () => {
    const runner = db.createQueryRunner();
    const execute = runner.query.bind(runner);
    const returnedRows: number[] = [];
    const hook = jest
      .spyOn(runner, "query")
      .mockImplementation(async (sql, parameters, structured?: true) => {
        const result: unknown = structured
          ? await execute(sql, parameters, true)
          : await execute(sql, parameters);
        if (/^SELECT\b/i.test(sql)) {
          const rows = Array.isArray(result)
            ? result
            : result && typeof result === "object" && "records" in result
              ? result.records
              : undefined;
          if (!Array.isArray(rows)) throw new Error("Expected SELECT rows");
          returnedRows.push(rows.length);
        }
        return result;
      });
    try {
      const qb = query()
        .leftJoinAndSelect("r.children", "children")
        .setQueryRunner(runner);
      const first = await byId().paginate(qb, { limit: 1 });
      expect(first.nodes[0].children).toHaveLength(3);
      expect(queries).toHaveLength(3);
      expect(returnedRows).toEqual([2, 3, 1]);
      queries.length = 0;
      returnedRows.length = 0;
      const second = await byId().paginate(qb, {
        limit: 1,
        pageCursor: first.nextPageCursor,
        noTotalCount: true,
      });
      expect(second.nodes.map((node) => node.id)).toEqual([2]);
      expect(second.hasPrevPage).toBe(true);
      expect(queries).toHaveLength(3);
      expect(returnedRows).toEqual([2, 1, 1]);
      expect(queries.every(({ sql }) => !/\bCOUNT\s*\(/i.test(sql))).toBe(true);
      queries.length = 0;
      await byId().paginateRaw(
        query().leftJoinAndSelect("r.owner", "owner").setQueryRunner(runner),
        { limit: 1, noTotalCount: true },
      );
      expect(queries).toHaveLength(1);
    } finally {
      hook.mockRestore();
      await runner.release();
    }
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

  it("preserves root identity when a partial projection omits the primary key", async () => {
    const qb = query().select("r.rank");
    const original = qb.getQueryAndParameters();
    const pages: unknown[] = [];
    let cursor: string | null = null;
    let visits = 0;
    for (;;) {
      const page: Paginated<CoreRecord> = await byId().paginate(qb, {
        limit: 2,
        pageCursor: cursor,
      });
      pages.push(
        ...page.nodes.map(
          (node) => JSON.parse(JSON.stringify(node)) as unknown,
        ),
      );
      if (!page.hasNextPage) break;
      if (++visits > 3) throw new Error("Partial traversal did not end");
      cursor = page.nextPageCursor;
    }
    expect(pages).toStrictEqual([
      { rank: 2 },
      { rank: 2 },
      { rank: 1 },
      { rank: 1 },
      { rank: 2 },
      { rank: 2 },
    ]);
    expect(qb.getQueryAndParameters()).toEqual(original);
  });

  it("retains roots whose selected nullable columns are all NULL", async () => {
    const qb = query().select("r.name");
    const first = await byId().paginate(qb, { limit: 2 });
    expect(
      first.nodes.map((node) => JSON.parse(JSON.stringify(node)) as unknown),
    ).toStrictEqual([{ name: null }, { name: "a" }]);
    const second = await byId().paginate(qb, {
      limit: 2,
      pageCursor: first.nextPageCursor,
    });
    expect(
      second.nodes.map((node) => JSON.parse(JSON.stringify(node)) as unknown),
    ).toStrictEqual([{ name: "a" }, { name: "b" }]);
  });

  it("does not expose hidden sort columns through whole-entity selections", async () => {
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: { hidden: "ASC", id: "ASC" },
    });
    const first = await paginator.paginate(query(), { limit: 2 });
    const second = await paginator.paginate(query(), {
      limit: 2,
      pageCursor: first.nextPageCursor,
    });
    expect(second.nodes.map((node) => node.id)).toEqual([3, 4]);
    expect(
      first.nodes
        .concat(second.nodes)
        .every((node) => node.hidden === undefined),
    ).toBe(true);
    const raw = await paginator.paginateRaw(query(), { limit: 2 });
    expect(raw.nodes.every((node) => !("r_hidden" in node))).toBe(true);
    expect(
      raw.nodes.every((node) =>
        Object.keys(node).every((key) => !key.startsWith("__paginator_")),
      ),
    ).toBe(true);
  });

  it("allocates raw boundary aliases around caller-selected colliding names", async () => {
    const qb = query()
      .select("r.id", "__paginator_0")
      .addSelect("r.rank", "__paginator_1");
    const paginator = new CursorPaginator(CoreRecord, {
      orderBy: { name: "ASC", id: "DESC" },
    });
    const first = await paginator.paginateRaw<{
      __paginator_0: number;
      __paginator_1: number;
    }>(qb, { limit: 2 });
    expect(first.nodes).toStrictEqual([
      { __paginator_0: 6, __paginator_1: 2 },
      { __paginator_0: 3, __paginator_1: 1 },
    ]);
    const second = await paginator.paginateRaw<{
      __paginator_0: number;
      __paginator_1: number;
    }>(qb, { limit: 2, pageCursor: first.nextPageCursor });
    expect(second.nodes).toStrictEqual([
      { __paginator_0: 2, __paginator_1: 2 },
      { __paginator_0: 4, __paginator_1: 1 },
    ]);
  });

  it.each([
    ["generated", () => query().select("r").addSelect("r.rank", "r_id")],
    [
      "explicit",
      () => query().select("r.id", "same").addSelect("r.rank", "same"),
    ],
  ])(
    "rejects duplicate %s raw output aliases before querying",
    async (_name, build) => {
      await expect(
        byId().paginateRaw(build(), { limit: 2 }),
      ).rejects.toMatchObject({
        name: "PaginationInputError",
        code: "UNSUPPORTED_QUERY",
      });
      expect(queries).toHaveLength(0);
    },
  );

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
    const backwards = last.nodes.map((node) => node.record_key);
    let backwardPages = 0;
    while (last.hasPrevPage) {
      if (++backwardPages > 6) throw new Error("Raw traversal did not end");
      last = await paginator.paginateRaw<{
        record_key: number;
        label: string | null;
      }>(qb, { limit: 2, pageCursor: last.prevPageCursor });
      backwards.unshift(...last.nodes.map((node) => node.record_key));
    }
    expect(backwards).toEqual(ids);
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

  it("uses fresh existence probes when preceding rows disappear between reads", async () => {
    const first = await byId().paginate(query(), { limit: 2 });
    const runner = db.createQueryRunner();
    const execute = runner.query.bind(runner);
    let deleted = false;
    const hook = jest
      .spyOn(runner, "query")
      .mockImplementation(async (sql, parameters, structured?: true) => {
        const result: unknown = structured
          ? await execute(sql, parameters, true)
          : await execute(sql, parameters);
        if (!deleted && /^SELECT\b.*ORDER BY.*LIMIT/is.test(sql)) {
          deleted = true;
          await db.getRepository(CoreChild).clear();
          await db.getRepository(CoreRecord).delete([1, 2]);
        }
        return result;
      });
    try {
      const page = await byId().paginate(query().setQueryRunner(runner), {
        limit: 2,
        pageCursor: first.nextPageCursor,
        noTotalCount: true,
      });
      expect(deleted).toBe(true);
      expect(page.nodes.map((node) => node.id)).toEqual([3, 4]);
      expect(page.hasPrevPage).toBe(false);
      expect(page.hasNextPage).toBe(true);
    } finally {
      hook.mockRestore();
      await runner.release();
    }
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
