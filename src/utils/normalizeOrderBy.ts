import type { ObjectLiteral } from "typeorm";
import type { NormalizedOrder, OrderBy } from "../interfaces/paginator";
import { PaginationInputError } from "../errors";

export function normalizeOrderBy<TEntity extends ObjectLiteral>(
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[],
): NormalizedOrder[] {
  const result: NormalizedOrder[] = [];
  const seen = new Set<string>();
  const invalid = (message: string): never => {
    throw new PaginationInputError("INVALID_ORDER", message);
  };
  for (const order of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    if (!order || typeof order !== "object" || Array.isArray(order)) {
      invalid("OrderBy must contain column/direction objects");
    }
    for (const [key, value] of Object.entries(order)) {
      if (seen.has(key)) invalid(`Duplicate ordering column: ${key}`);
      seen.add(key);
      let direction: unknown = value;
      let nulls: unknown = "LAST";
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (
          Object.keys(value).some((k) => k !== "direction" && k !== "nulls")
        ) {
          invalid(`Unknown ordering option for ${key}`);
        }
        direction = value.direction === undefined ? "ASC" : value.direction;
        nulls = value.nulls === undefined ? "LAST" : value.nulls;
        if (
          direction !== "ASC" &&
          direction !== "asc" &&
          direction !== "DESC" &&
          direction !== "desc"
        ) {
          invalid(`Invalid direction for ${key}`);
        }
      }
      if (
        !["ASC", "asc", "DESC", "desc", 1, -1].includes(
          direction as string | number,
        )
      ) {
        invalid(`Invalid direction for ${key}`);
      }
      if (!["FIRST", "first", "LAST", "last"].includes(nulls as string)) {
        invalid(`Invalid NULL placement for ${key}`);
      }
      result.push({
        key,
        direction:
          direction === "ASC" || direction === "asc" || direction === 1
            ? "ASC"
            : "DESC",
        nulls: nulls === "FIRST" || nulls === "first" ? "FIRST" : "LAST",
      });
    }
  }
  if (!result.length) invalid("OrderBy must not be empty");
  return result;
}
