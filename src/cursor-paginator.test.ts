import {
  Column,
  Connection,
  createConnection,
  Entity,
  FindOperator,
  PrimaryGeneratedColumn,
} from "typeorm";

import { CursorPaginator } from "./cursor-paginator";
import {
  CursorPagination,
  PromiseCursorPagination,
} from "./interfaces/paginator";

function timestampTransformFrom(value: any): any {
  if (value instanceof FindOperator) {
    return new FindOperator(
      (value as any)._type,
      timestampTransformFrom((value as any)._value),
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
  if (typeof value === "number") {
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
    transformer: {
      from: timestampTransformFrom,
      to: timestampTransformTo,
    },
  })
  createdAt!: number;
}

function testPromisePaginationAndResolve(
  pagination: PromiseCursorPagination<any>,
): Promise<CursorPagination<any>> {
  expect(pagination.totalCount).toBeInstanceOf(Promise);
  expect(pagination.hasNextPage).toBeInstanceOf(Promise);
  expect(pagination.hasPrevPage).toBeInstanceOf(Promise);
  expect(pagination.nextPageCursor).toBeInstanceOf(Promise);
  expect(pagination.prevPageCursor).toBeInstanceOf(Promise);
  expect(pagination.nodes).toBeInstanceOf(Promise);

  return Promise.resolve().then(async () => ({
    totalCount: await pagination.totalCount,
    nodes: await pagination.nodes,
    hasPrevPage: await pagination.hasPrevPage,
    hasNextPage: await pagination.hasNextPage,
    prevPageCursor: await pagination.prevPageCursor,
    nextPageCursor: await pagination.nextPageCursor,
  }));
}

describe("testsuite of cursor-paginator", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await createConnection({
      type: "sqlite",
      database: ":memory:",
      entities: [User],
      synchronize: true,
    });
  });

  beforeEach(async () => {
    await connection.getRepository(User).clear();
  });

  it("test paginate default", async () => {
    const repoUsers = connection.getRepository(User);

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
        id: 'DESC',
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
    const repoUsers = connection.getRepository(User);

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
        id: 'DESC',
      },
      take: 3,
    });

    const pagination = await paginator.paginate(repoUsers.createQueryBuilder());
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
      { prevPageCursor: pagination.prevPageCursor },
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
      { nextPageCursor: pagination.nextPageCursor },
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
      { prevPageCursor: paginationNext.prevPageCursor },
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
      { nextPageCursor: paginationNext.nextPageCursor },
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
    const repoUsers = connection.getRepository(User);

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
      orderBy: [{ name: 'ASC' }, { id: 'DESC' }],
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
      { take: 2 },
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
      { take: 2, nextPageCursor: pagination2.nextPageCursor },
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
      { take: 2, nextPageCursor: pagination2Next.nextPageCursor },
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
      { take: 2, prevPageCursor: pagination2NextNext.prevPageCursor },
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

  it("test cursor paginate with transformer", async () => {
    const repoUsers = connection.getRepository(User);

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
        createdAt: 'DESC',
      },
      take: 3,
    });

    const pagination = await paginator.paginate(repoUsers.createQueryBuilder());
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
      { prevPageCursor: pagination.prevPageCursor },
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
      { nextPageCursor: pagination.nextPageCursor },
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
      { prevPageCursor: paginationNext.prevPageCursor },
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
      { nextPageCursor: paginationNext.nextPageCursor },
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

  it("test promisePaginate default", async () => {
    const repoUsers = connection.getRepository(User);

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
        id: 'DESC',
      },
    });

    const pagination = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder()),
    );
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3], nodes[2], nodes[1], nodes[0]],
      hasPrevPage: false,
      hasNextPage: false,
      nextPageCursor: expect.any(String),
      prevPageCursor: expect.any(String),
    });
  });

  it("test cursor promisePaginate by single-order", async () => {
    const repoUsers = connection.getRepository(User);

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
        id: 'DESC',
      },
      take: 3,
    });

    const pagination = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder()),
    );

    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationPrev = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        prevPageCursor: pagination.prevPageCursor,
      }),
    );
    expect(paginationPrev).toEqual({
      totalCount: 6,
      nodes: [],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: null,
      nextPageCursor: null,
    });

    const paginationNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        nextPageCursor: pagination.nextPageCursor,
      }),
    );
    expect(paginationNext).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[1], nodes[0]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextPrev = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        prevPageCursor: paginationNext.prevPageCursor,
      }),
    );
    expect(paginationNextPrev).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        nextPageCursor: paginationNext.nextPageCursor,
      }),
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

  it("test cursor promisePaginate by multi-orders", async () => {
    const repoUsers = connection.getRepository(User);

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
      orderBy: [{ name: 'ASC' }, { id: 'DESC' }],
    });

    const pagination1 = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder()),
    );
    expect(pagination1).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1], nodes[5], nodes[3], nodes[0]],
      hasPrevPage: false,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2 = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), { take: 2 }),
    );
    expect(pagination2).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2Next = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        take: 2,
        nextPageCursor: pagination2.nextPageCursor,
      }),
    );
    expect(pagination2Next).toEqual({
      totalCount: 6,
      nodes: [nodes[1], nodes[5]],
      hasPrevPage: true,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2NextNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        take: 2,
        nextPageCursor: pagination2Next.nextPageCursor,
      }),
    );
    expect(pagination2NextNext).toEqual({
      totalCount: 6,
      nodes: [nodes[3], nodes[0]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const pagination2NextNextPrev = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        take: 2,
        prevPageCursor: pagination2NextNext.prevPageCursor,
      }),
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

  it("test cursor promisePaginate with transformer", async () => {
    const repoUsers = connection.getRepository(User);

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
        createdAt: 'DESC',
      },
      take: 3,
    });

    const pagination = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder()),
    );
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationPrev = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        prevPageCursor: pagination.prevPageCursor,
      }),
    );
    expect(paginationPrev).toEqual({
      totalCount: 6,
      nodes: [],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: null,
      nextPageCursor: null,
    });

    const paginationNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        nextPageCursor: pagination.nextPageCursor,
      }),
    );
    expect(paginationNext).toEqual({
      totalCount: 6,
      nodes: [nodes[3], nodes[5], nodes[0]],
      hasPrevPage: true,
      hasNextPage: false,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextPrev = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        prevPageCursor: paginationNext.prevPageCursor,
      }),
    );
    expect(paginationNextPrev).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1]],
      hasPrevPage: false,
      hasNextPage: true,
      prevPageCursor: expect.any(String),
      nextPageCursor: expect.any(String),
    });

    const paginationNextNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        nextPageCursor: paginationNext.nextPageCursor,
      }),
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
});
