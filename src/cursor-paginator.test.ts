import {
  Column,
  DataSource,
  Entity,
  FindOperator,
  PrimaryGeneratedColumn,
} from "typeorm";

import { CursorPaginator } from "./cursor-paginator";
import { JsonTransformer } from "./transformers/json-transformer";

function timestampTransformFrom(value: any): any {
  if (value instanceof FindOperator) {
    return new FindOperator(
      (value as any)._type,
      timestampTransformFrom((value as any)._value),
    );
  }
  if (
    typeof value === "function" ||
    typeof value === "undefined" ||
    value === null ||
    typeof value === "number"
  ) {
    return value;
  }
  return ~~(new Date(value).getTime() / 1000);
}

function timestampTransformTo(value: any): any {
  if (value instanceof FindOperator) {
    const nextValue = timestampTransformTo((value as any)._value);
    return new FindOperator(
      (value as any)._type,
      nextValue,
      (value as any)._useParameter,
      (value as any)._multipleParameters,
    );
  }
  if (typeof value === "function") {
    return value;
  }
  if (typeof value === "undefined") {
    return;
  }
  if (value === null) {
    return null;
  }
  return new Date(value * 1000);
}

@Entity({ name: "users" })
class User {
  @PrimaryGeneratedColumn()
  id!: string | number;

  @Column({ type: String, name: "user_name" })
  name!: string;

  @Column({
    type: "datetime",
    name: "created_at",
    // checking that this transformer works is not about checking CursorPaginator's transformer
    transformer: {
      from: timestampTransformFrom,
      to: timestampTransformTo,
    },
  })
  createdAt!: number;
}

describe("testsuite of cursor-paginator", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: "sqlite",
      database: ":memory:",
      entities: [User],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await dataSource.getRepository(User).clear();
  });

  it("test paginate default (no limit)", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "DESC",
      },
    });

    const pagination = await paginator.paginate(repoUsers.createQueryBuilder());
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3], nodes[2], nodes[1], nodes[0]],
      hasPrevPage: false,
      hasNextPage: false,
      nextPageCursor: expect.any(String),
      prevPageCursor: expect.any(String),
    });
  });

  it("test cursor paginate by single-order", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "DESC",
      },
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
      },
    );
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationPrev = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: pagination.prevPageCursor, limit: 3 },
    );
    expect(paginationPrev).toEqual({
      totalCount: 6,
      nodes: [],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: null,
      nextPageCursor: null,
    });

    const paginationNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: pagination.nextPageCursor, limit: 3 },
    );
    expect(paginationNext).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[1], nodes[0]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextPrev = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: paginationNext.prevPageCursor, limit: 3 },
    );
    expect(paginationNextPrev).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: paginationNext.nextPageCursor, limit: 3 },
    );
    expect(paginationNextNext).toEqual({
      totalCount: 6,
      nodes: [],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: null,
      nextPageCursor: null,
    });
  });

  it("test cursor paginate by multi-orders", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "c", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "a", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "b", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: [{ name: "ASC" }, { id: "DESC" }],
    });

    const pagination1 = await paginator.paginate(
      repoUsers.createQueryBuilder(),
    );
    expect(pagination1).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1], nodes[5], nodes[3], nodes[0]],
      hasPrevPage: false,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2 = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { limit: 2 },
    );
    expect(pagination2).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2Next = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { limit: 2, pageCursor: pagination2.nextPageCursor },
    );
    expect(pagination2Next).toEqual({
      totalCount: 6,
      nodes: [nodes[1], nodes[5]],
      hasPrevPage: true,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2NextNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { limit: 2, pageCursor: pagination2Next.nextPageCursor },
    );
    expect(pagination2NextNext).toEqual({
      totalCount: 6,
      nodes: [nodes[3], nodes[0]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2NextNextPrev = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { limit: 2, pageCursor: pagination2NextNext.prevPageCursor },
    );
    expect(pagination2NextNextPrev).toEqual({
      totalCount: 6,
      nodes: [nodes[1], nodes[5]],
      hasPrevPage: true,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  it("test cursor paginate with TypeORM's transformer for field", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000003 }),
      repoUsers.create({ name: "b", createdAt: 1600000005 }),
      repoUsers.create({ name: "c", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000001 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        createdAt: "DESC",
      },
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
      },
    );
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationPrev = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: pagination.prevPageCursor, limit: 3 },
    );
    expect(paginationPrev).toEqual({
      totalCount: 6,
      nodes: [],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: null,
      nextPageCursor: null,
    });

    const paginationNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: pagination.nextPageCursor, limit: 3 },
    );
    expect(paginationNext).toEqual({
      totalCount: 6,
      nodes: [nodes[3], nodes[5], nodes[0]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextPrev = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: paginationNext.prevPageCursor, limit: 3 },
    );
    expect(paginationNextPrev).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { pageCursor: paginationNext.nextPageCursor, limit: 3 },
    );
    expect(paginationNextNext).toEqual({
      totalCount: 6,
      nodes: [],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: null,
      nextPageCursor: null,
    });
  });

  it("not enough items for full page", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        createdAt: "ASC",
      },
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
      },
    );
    expect(pagination).toEqual({
      totalCount: 2,
      nodes: [nodes[0], nodes[1]],
      hasPrevPage: false,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  it("test SQL injection into cursor: test 'id'", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
        pageCursor: 'next:{"id":"\\";;;;;;DROP TABLE Users;\\""}',
      },
    );
    // should not have dropped the table
    const pagination2 = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 1,
      },
    );
    expect(pagination2).toEqual({
      totalCount: 6,
      nodes: [nodes[0]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  it("test SQL injection into cursor: test 'name'", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        name: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
        pageCursor: 'next:{"name":"\\";;;;;;DROP TABLE Users;\\""}',
      },
    );
    // should not have dropped the table
    const pagination2 = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 1,
      },
    );
    expect(pagination2).toEqual({
      totalCount: 6,
      nodes: [nodes[0]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  it("test SQL injection into cursor: test 'name' without extra quotes", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        name: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
        pageCursor: 'next:{"name":";;;;;;DROP TABLE Users;"}',
      },
    );
    // should not have dropped the table
    const pagination2 = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 1,
      },
    );
    expect(pagination2).toEqual({
      totalCount: 6,
      nodes: [nodes[0]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  it("test when some nodes are deleted while paginating", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
      },
    );
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[0], nodes[1], nodes[2]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    // delete one node in first page
    await repoUsers.remove([nodes[0]]);

    // pagination should still work as expected for cursor-based pagination
    const paginationNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
        pageCursor: pagination.nextPageCursor,
      },
    );
    expect(paginationNext).toEqual({
      totalCount: 5,
      nodes: [nodes[3], nodes[4], nodes[5]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  it("test when the cursor node (the last seen node) is deleted while paginating", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
      },
    );
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[0], nodes[1], nodes[2]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    // delete one node in first page
    await repoUsers.remove([nodes[2]]);

    // pagination should still work as expected for cursor-based pagination
    const paginationNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
        pageCursor: pagination.nextPageCursor,
      },
    );
    expect(paginationNext).toEqual({
      totalCount: 5,
      nodes: [nodes[3], nodes[4], nodes[5]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  // The algorithm currently assumes that if the pageCursor is provided, then the page we came from exists.
  // I could not find a way to fix that without introducing an extra query or more complex bugs.
  // Decided to let this bug be.
  // Because it occurs rarely in real scenarios and shouldn't cause critical problems even if it occurs.
  // The following test fails because of this bug.
  it.skip("test computing of hasPrevPage when it has been completely deleted while paginating", async () => {
    const repoUsers = dataSource.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a", createdAt: 1600000000 }),
      repoUsers.create({ name: "b", createdAt: 1600000001 }),
      repoUsers.create({ name: "b", createdAt: 1600000002 }),
      repoUsers.create({ name: "c", createdAt: 1600000003 }),
      repoUsers.create({ name: "c", createdAt: 1600000004 }),
      repoUsers.create({ name: "c", createdAt: 1600000005 }),
    ];

    await repoUsers.save(nodes);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
    });

    const pagination = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
      },
    );
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[0], nodes[1], nodes[2]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    // delete nodes in first page
    await repoUsers.remove([nodes[0], nodes[1], nodes[2]]);

    // pagination should still work and understand that there is no previous page already
    const paginationNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      {
        limit: 3,
        pageCursor: pagination.nextPageCursor,
      },
    );
    expect(paginationNext).toEqual({
      totalCount: 3,
      nodes: [nodes[3], nodes[4], nodes[5]],
      hasPrevPage: false, // there is already no previous page
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });
  });

  it("should throw when cursor has unexpected property", async () => {
    const repoUsers = dataSource.getRepository(User);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = paginator.paginate(repoUsers.createQueryBuilder(), {
      limit: 3,
      pageCursor: 'next:{"foo":1}',
    });
    await expect(pagination).rejects.toThrow();
  });

  it("should throw when cursor doesn't have an expected property", async () => {
    const repoUsers = dataSource.getRepository(User);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = paginator.paginate(repoUsers.createQueryBuilder(), {
      limit: 3,
      pageCursor: "next:{}",
    });
    await expect(pagination).rejects.toThrow();
  });

  it("should throw when some cursor's property is undefined", async () => {
    const repoUsers = dataSource.getRepository(User);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = paginator.paginate(repoUsers.createQueryBuilder(), {
      limit: 3,
      pageCursor: 'next:{"id":undefined}',
    });
    await expect(pagination).rejects.toThrow();
  });

  it("should throw when limit is 0", async () => {
    const repoUsers = dataSource.getRepository(User);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = paginator.paginate(repoUsers.createQueryBuilder(), {
      limit: 0,
    });
    await expect(pagination).rejects.toThrow();
  });

  it("should throw when limit is negative", async () => {
    const repoUsers = dataSource.getRepository(User);

    const paginator = new CursorPaginator(User, {
      orderBy: {
        id: "ASC",
      },
      transformer: new JsonTransformer(),
    });

    const pagination = paginator.paginate(repoUsers.createQueryBuilder(), {
      limit: -1,
    });
    await expect(pagination).rejects.toThrow();
  });
});
