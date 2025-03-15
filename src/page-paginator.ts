import { SelectQueryBuilder, ObjectType, ObjectLiteral } from "typeorm";

import {
  OrderBy,
  PromisePagePagination,
  PagePagination,
  Nullable,
  Take,
} from "./interfaces/paginator";
import { normalizeOrderBy } from "./utils/normalizeOrderBy";

export interface PagePaginatorParams<TEntity extends ObjectLiteral> {
  take?: Nullable<Take> | number | null;
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[];
}

export interface PagePaginatorPaginateParams<TEntity extends ObjectLiteral> {
  page?: number | null;
  take?: number | null;
  orderBy?: OrderBy<TEntity> | OrderBy<TEntity>[];
}

export class PagePaginator<TEntity extends ObjectLiteral> {
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[];
  takeOptions: Take;

  constructor(
    public entity: ObjectType<TEntity>,
    { orderBy, take }: PagePaginatorParams<TEntity>,
  ) {
    this.orderBy = orderBy;
    this.takeOptions =
      typeof take === "number"
        ? {
            default: take,
            min: 0,
            max: Infinity,
          }
        : {
            default: take?.default ?? 20,
            min: Math.max(0, take?.min ?? 0), // never negative
            max: take?.max ?? Infinity,
          };
  }

  async paginate(
    qb: SelectQueryBuilder<TEntity>,
    params: PagePaginatorPaginateParams<TEntity> = {},
    isRaw = false,
  ): Promise<PagePagination<TEntity>> {
    const page = Math.max(params.page ?? 1, 1);
    const take = Math.max(
      this.takeOptions.min,
      Math.min(params.take ?? this.takeOptions.default, this.takeOptions.max),
    );

    const qbForCount = qb.clone();

    for (const [key, value] of normalizeOrderBy(
      params.orderBy ?? this.orderBy,
    )) {
      qb.addOrderBy(`${qb.alias}.${key}`, value ? "ASC" : "DESC");
    }

    let hasNext = false;
    const query = qb
      .clone()
      .offset((page - 1) * take)
      .limit(take + 1);
    const nodes = await (isRaw ? query.getRawMany() : query.getMany()).then(
      (nodes) => {
        if (nodes.length > take) {
          hasNext = true;
        }
        return nodes.slice(0, take);
      },
    );

    return {
      count: await qbForCount.getCount(),
      nodes,
      hasNext,
    };
  }

  promisePaginate(
    qb: SelectQueryBuilder<TEntity>,
    params: PagePaginatorPaginateParams<TEntity> = {},
    isRaw = false,
  ): PromisePagePagination<TEntity> {
    const page = Math.max(params.page ?? 1, 1);
    const take = Math.max(
      this.takeOptions.min,
      Math.min(params.take ?? this.takeOptions.default, this.takeOptions.max),
    );

    const qbForCount = qb.clone();

    for (const [key, value] of normalizeOrderBy(
      params.orderBy ?? this.orderBy,
    )) {
      qb.addOrderBy(`${qb.alias}.${key}`, value ? "ASC" : "DESC");
    }

    let cachePromiseNodes = null as Promise<
      Omit<PagePagination<any>, "count">
    > | null;
    const promiseNodes = () => {
      if (!cachePromiseNodes) {
        const query = qb
          .clone()
          .offset((page - 1) * take)
          .limit(take + 1);
        cachePromiseNodes = (isRaw ? query.getRawMany() : query.getMany()).then(
          (nodes) => {
            let hasNext = false;
            if (nodes.length > take) {
              hasNext = true;
            }
            return {
              hasNext,
              nodes: nodes.slice(0, take),
            };
          },
        );
      }
      return cachePromiseNodes;
    };

    return {
      get count() {
        return qbForCount.getCount();
      },
      get nodes() {
        return promiseNodes().then(({ nodes }) => nodes);
      },
      get hasNext() {
        return promiseNodes().then(({ hasNext }) => hasNext);
      },
    };
  }
}
