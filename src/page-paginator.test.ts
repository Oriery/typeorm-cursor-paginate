import {
  Column,
  Connection,
  createConnection,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

import { PagePagination, PromisePagePagination } from ".";
import { PagePaginator } from "./page-paginator";

@Entity({ name: "users" })
class User {
  @PrimaryGeneratedColumn()
  id!: string | number;

  @Column({ type: String, name: "user_name" })
  name!: string;
}

function testPromisePaginationAndResolve(
  pagination: PromisePagePagination<any>,
): Promise<PagePagination<any>> {
  expect(pagination.totalCount).toBeInstanceOf(Promise);
  expect(pagination.hasNextPage).toBeInstanceOf(Promise);
  expect(pagination.nodes).toBeInstanceOf(Promise);

  return Promise.resolve().then(async () => ({
    totalCount: await pagination.totalCount,
    nodes: await pagination.nodes,
    hasNextPage: await pagination.hasNextPage,
  }));
}

describe("testsuite of page-paginator", () => {
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
      repoUsers.create({ name: "a" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
    ];

    await repoUsers.save(nodes);

    const paginator = new PagePaginator(User, {
      orderBy: {
        id: 'DESC',
      },
    });

    const pagination = await paginator.paginate(repoUsers.createQueryBuilder());
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3], nodes[2], nodes[1], nodes[0]],
      hasNextPage: false,
    });
  });

  it("test page paginate by single-order", async () => {
    const repoUsers = connection.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
    ];

    await repoUsers.save(nodes);

    const paginator = new PagePaginator(User, {
      orderBy: {
        id: 'DESC',
      },
      take: 3,
    });

    const pagination = await paginator.paginate(repoUsers.createQueryBuilder());
    expect(pagination).toEqual({
      totalCount: 6,
      nodes: [nodes[5], nodes[4], nodes[3]],
      hasNextPage: true,
    });

    const paginationNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { page: 2 },
    );
    expect(paginationNext).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[1], nodes[0]],
      hasNextPage: false,
    });

    const paginationNextNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { page: 3 },
    );
    expect(paginationNextNext).toEqual({
      totalCount: 6,
      nodes: [],
      hasNextPage: false,
    });
  });

  it("test page paginate by multi-orders", async () => {
    const repoUsers = connection.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "a" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "c" }),
    ];

    await repoUsers.save(nodes);

    const paginator = new PagePaginator(User, {
      orderBy: [{ name: 'ASC' }, { id: 'DESC' }],
    });

    const pagination1 = await paginator.paginate(
      repoUsers.createQueryBuilder(),
    );
    expect(pagination1).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1], nodes[5], nodes[3], nodes[0]],
      hasNextPage: false,
    });

    const pagination2 = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { take: 2 },
    );
    expect(pagination2).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4]],
      hasNextPage: true,
    });

    const pagination2Next = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { take: 2, page: 2 },
    );
    expect(pagination2Next).toEqual({
      totalCount: 6,
      nodes: [nodes[1], nodes[5]],
      hasNextPage: true,
    });

    const pagination2NextNext = await paginator.paginate(
      repoUsers.createQueryBuilder(),
      { take: 2, page: 3 },
    );
    expect(pagination2NextNext).toEqual({
      totalCount: 6,
      nodes: [nodes[3], nodes[0]],
      hasNextPage: false,
    });
  });

  it("test promisePaginate default", async () => {
    const repoUsers = connection.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
    ];

    await repoUsers.save(nodes);

    const paginator = new PagePaginator(User, {
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
      hasNextPage: false,
    });
  });

  it("test page promisePaginate by single-order", async () => {
    const repoUsers = connection.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "a" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "c" }),
    ];

    await repoUsers.save(nodes);

    const paginator = new PagePaginator(User, {
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
      hasNextPage: true,
    });

    const paginationNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), { page: 2 }),
    );
    expect(paginationNext).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[1], nodes[0]],
      hasNextPage: false,
    });

    const paginationNextNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), { page: 3 }),
    );
    expect(paginationNextNext).toEqual({
      totalCount: 6,
      nodes: [],
      hasNextPage: false,
    });
  });

  it("test page promisePaginate by multi-orders", async () => {
    const repoUsers = connection.getRepository(User);

    const nodes = [
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "a" }),
      repoUsers.create({ name: "c" }),
      repoUsers.create({ name: "b" }),
      repoUsers.create({ name: "c" }),
    ];

    await repoUsers.save(nodes);

    const paginator = new PagePaginator(User, {
      orderBy: [{ name: 'ASC' }, { id: 'DESC' }],
    });

    const pagination1 = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder()),
    );
    expect(pagination1).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4], nodes[1], nodes[5], nodes[3], nodes[0]],
      hasNextPage: false,
    });

    const pagination2 = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), { take: 2 }),
    );
    expect(pagination2).toEqual({
      totalCount: 6,
      nodes: [nodes[2], nodes[4]],
      hasNextPage: true,
    });

    const pagination2Next = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        take: 2,
        page: 2,
      }),
    );
    expect(pagination2Next).toEqual({
      totalCount: 6,
      nodes: [nodes[1], nodes[5]],
      hasNextPage: true,
    });

    const pagination2NextNext = await testPromisePaginationAndResolve(
      paginator.promisePaginate(repoUsers.createQueryBuilder(), {
        take: 2,
        page: 3,
      }),
    );
    expect(pagination2NextNext).toEqual({
      totalCount: 6,
      nodes: [nodes[3], nodes[0]],
      hasNextPage: false,
    });
  });
});
