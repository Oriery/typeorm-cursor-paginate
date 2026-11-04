import type { Paginated } from "typeorm-cursor-paginate";

export interface Constructor<T> {
  new (...args: unknown[]): T;
}

export declare function createPage<T>(
  entity: Constructor<T>,
): Constructor<Paginated<T>>;
