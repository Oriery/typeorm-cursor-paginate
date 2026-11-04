const assert = require("node:assert/strict");

const publicNames = [
  "Base64Transformer",
  "CursorPaginator",
  "JsonTransformer",
  "PaginationInputError",
  "default",
  "paginate",
  "paginateRaw",
];

async function exercise(api, orm = require("typeorm")) {
  const { DataSource, EntitySchema } = orm;
  assert.deepEqual(Object.keys(api).sort(), publicNames);
  assert.equal(api.default, api.paginate);
  for (const name of publicNames) assert.equal(typeof api[name], "function");

  class User {}
  for (const options of [
    { transformer: new api.JsonTransformer() },
    { cursorTransformer: null },
    { cursorTransformer: { parse: () => ({}) } },
    { cursorTransformer: { parse: 1, stringify: () => "cursor" } },
  ]) {
    assert.throws(
      () =>
        new api.CursorPaginator(User, { orderBy: { id: "ASC" }, ...options }),
      (error) =>
        error instanceof api.PaginationInputError &&
        error.code === "INVALID_OPTION",
    );
  }
  const schema = new EntitySchema({
    name: "User",
    target: User,
    columns: {
      id: { type: Number, primary: true },
      name: { type: String },
      ownerId: { type: Number },
    },
  });
  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [schema],
    synchronize: true,
  });
  await dataSource.initialize();
  try {
    await dataSource.getRepository(User).save([
      { id: 4, name: "a", ownerId: 7 },
      { id: 3, name: "b", ownerId: 7 },
      { id: 2, name: "c", ownerId: 7 },
      { id: 1, name: "c", ownerId: 7 },
      { id: 5, name: "hidden", ownerId: 8 },
    ]);
    const query = dataSource
      .getRepository(User)
      .createQueryBuilder("user")
      .where("user.ownerId = :ownerId", { ownerId: 7 });
    const before = query.getQueryAndParameters();
    const orderBy = { name: "ASC", id: "DESC" };
    const paginator = new api.CursorPaginator(User, { orderBy });
    const first = await paginator.paginate(query, { limit: 2 });
    const second = await api.paginate(User, query, {
      orderBy,
      limit: 2,
      pageCursor: first.nextPageCursor,
    });
    const back = await api.default(User, query, {
      orderBy,
      limit: 2,
      pageCursor: second.prevPageCursor,
    });
    assert.deepEqual(
      first.nodes.map((user) => user.id),
      [4, 3],
    );
    assert.deepEqual(
      second.nodes.map((user) => user.id),
      [2, 1],
    );
    assert.deepEqual(back.nodes, first.nodes);
    assert.ok(first.nodes[0] instanceof User);
    assert.equal(first.totalCount, 4);
    assert.equal(first.hasPrevPage, false);
    assert.equal(first.hasNextPage, true);
    assert.equal(second.hasPrevPage, true);
    assert.equal(second.hasNextPage, false);
    assert.match(first.nextPageCursor, /^v3:/);

    const rawQuery = query
      .clone()
      .select("user.id", "user_id")
      .addSelect("user.name", "display_name");
    const raw = await api.paginateRaw(User, rawQuery, { orderBy, limit: 2 });
    assert.deepEqual(raw.nodes, [
      { user_id: 4, display_name: "a" },
      { user_id: 3, display_name: "b" },
    ]);
    assert.deepEqual(
      (await paginator.paginateRaw(rawQuery, { limit: 2 })).nodes,
      raw.nodes,
    );
    const unchecked = await paginator.paginate(query, {
      limit: 2,
      pageCursor: first.nextPageCursor,
      noTotalCount: true,
      noOppositePageCheck: true,
    });
    assert.equal(unchecked.totalCount, null);
    assert.equal(unchecked.hasPrevPage, null);
    assert.equal(unchecked.hasNextPage, false);

    const json = new api.JsonTransformer();
    const base64 = new api.Base64Transformer();
    const envelope = base64.parse(first.nextPageCursor.slice(3));
    assert.deepEqual(json.parse(json.stringify(envelope)), envelope);
    assert.deepEqual(base64.parse(base64.stringify(envelope)), envelope);
    const custom = new api.CursorPaginator(User, {
      orderBy,
      cursorTransformer: {
        parse: (text) => JSON.parse(text),
        stringify: (cursor) => JSON.stringify(cursor),
      },
    });
    const customFirst = await custom.paginate(query, { limit: 2 });
    const customSecond = await custom.paginate(query, {
      limit: 2,
      pageCursor: customFirst.nextPageCursor,
    });
    assert.deepEqual(customSecond.nodes, second.nodes);
    await assert.rejects(
      custom.paginate(query, { pageCursor: "v3:[]" }),
      (error) =>
        error instanceof api.PaginationInputError &&
        error.code === "INVALID_CURSOR",
    );
    for (const pageCursor of ["next:old-token", "prev:old-token"]) {
      await assert.rejects(
        paginator.paginate(query, { pageCursor }),
        (error) =>
          error instanceof api.PaginationInputError &&
          error.code === "UNSUPPORTED_CURSOR_VERSION",
      );
    }
    class WrongEntity {}
    await assert.rejects(
      api.paginate(WrongEntity, query, { orderBy }),
      (error) =>
        error instanceof api.PaginationInputError &&
        error.code === "UNSUPPORTED_QUERY",
    );
    assert.throws(
      () => api.paginate(User, query, { orderBy }, true),
      (error) => error instanceof api.PaginationInputError,
    );
    assert.deepEqual(query.getQueryAndParameters(), before);
  } finally {
    await dataSource.destroy();
  }
}

module.exports = { exercise, publicNames };
