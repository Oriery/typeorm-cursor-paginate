import type { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import type { Driver } from "typeorm/driver/Driver";
import { PaginationInputError } from "../errors";
import type { CursorValue } from "../interfaces/paginator";

export interface ValueColumn {
  column: ColumnMetadata;
  type: string;
  postgres: boolean;
}

const integerTypes = [
  "int",
  "integer",
  "int2",
  "int4",
  "smallint",
  "tinyint",
  "mediumint",
  "unsigned big int",
];
const floatTypes = [
  "real",
  "float",
  "float4",
  "float8",
  "double",
  "double precision",
];
const textTypes = [
  "text",
  "varchar",
  "character varying",
  "character",
  "char",
  "nchar",
  "nvarchar",
  "varying character",
  "native character",
  "citext",
  "uuid",
  "enum",
  "simple-enum",
];
const temporalTypes = [
  "timestamp",
  "timestamp without time zone",
  "timestamptz",
  "timestamp with time zone",
  "datetime",
  "date",
];
const decimalTypes = ["decimal", "numeric", "dec"];

export function valueColumn(
  column: ColumnMetadata,
  driver: Driver,
): ValueColumn {
  const type = driver.normalizeType(column);
  const postgres = driver.options.type === "postgres";
  if (
    column.isArray ||
    column.isVirtualProperty ||
    ![
      ...integerTypes,
      ...floatTypes,
      ...textTypes,
      ...temporalTypes,
      ...decimalTypes,
      "bigint",
      "int8",
      "boolean",
      "bool",
    ].includes(type)
  ) {
    throw new PaginationInputError(
      "UNSUPPORTED_VALUE",
      `Unsupported ordering storage type for ${column.propertyPath}: ${type}`,
    );
  }
  if (!postgres && decimalTypes.includes(type)) {
    throw new PaginationInputError(
      "UNSUPPORTED_VALUE",
      "SQLite decimal/numeric ordering is not an exact decimal representation; use integer units or a supported storage type",
    );
  }
  if (
    postgres &&
    decimalTypes.includes(type) &&
    column.precision != null &&
    ((column.scale ?? 0) < 0 || (column.scale ?? 0) > column.precision)
  ) {
    throw new PaginationInputError(
      "UNSUPPORTED_VALUE",
      "Numeric ordering requires 0 <= scale <= precision",
    );
  }
  if (column.isPrimary && temporalTypes.includes(type)) {
    throw new PaginationInputError(
      "UNSUPPORTED_VALUE",
      "Temporal primary keys cannot be hydrated without identity precision loss",
    );
  }
  return { column, type, postgres };
}

/** Select text ourselves: driver timestamp and numeric parsers may discard precision. */
export function boundaryExpression(
  expression: string,
  value: ValueColumn,
): string {
  if (!value.postgres) return expression;
  const temporal = (formatted: string, yearExpression = expression): string =>
    `CASE WHEN ${expression} IS NULL THEN NULL WHEN isfinite(${expression}) AND EXTRACT(YEAR FROM ${yearExpression}) BETWEEN 1 AND 9999 THEN ${formatted} ELSE CAST(${expression} AS text) END`;
  if (
    value.type === "timestamptz" ||
    value.type === "timestamp with time zone"
  ) {
    return temporal(
      `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z'`,
      `${expression} AT TIME ZONE 'UTC'`,
    );
  }
  if (
    value.type === "timestamp" ||
    value.type === "timestamp without time zone"
  ) {
    return temporal(`to_char(${expression}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`);
  }
  if (value.type === "date")
    return temporal(`to_char(${expression}, 'YYYY-MM-DD')`);
  if ([...decimalTypes, "bigint", "int8"].includes(value.type))
    return `CAST(${expression} AS text)`;
  return expression;
}

function validDate(value: string, type: string, postgres: boolean): boolean {
  const zoned = type === "timestamptz" || type === "timestamp with time zone";
  const pattern =
    type === "date"
      ? /^(\d{4})-(\d{2})-(\d{2})$/
      : /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z)?$/;
  const match = pattern.exec(value);
  if (!match || (type !== "date" && Boolean(match[8]) !== zoned)) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1])
    return false;
  if (type === "date") return true;
  // SQLite datetime ordering is textual: accept only TypeORM's millisecond storage layout.
  if (!postgres && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value))
    return false;
  return (
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59
  );
}

export function validateValue(
  value: unknown,
  spec: ValueColumn,
  external: boolean,
): CursorValue {
  const { column, type, postgres } = spec;
  let valid = false;
  if (value === null) valid = column.isNullable;
  else if (integerTypes.includes(type)) {
    valid = typeof value === "number" && Number.isSafeInteger(value);
    if (valid && postgres) {
      const max = ["smallint", "int2"].includes(type) ? 32767 : 2147483647;
      valid = (value as number) >= -max - 1 && (value as number) <= max;
    }
  } else if (type === "bigint" || type === "int8") {
    if (postgres) {
      valid =
        typeof value === "string" &&
        /^-?(0|[1-9]\d*)$/.test(value) &&
        value !== "-0";
      if (valid)
        valid =
          BigInt(value as string) >= -(2n ** 63n) &&
          BigInt(value as string) < 2n ** 63n;
    } else valid = typeof value === "number" && Number.isSafeInteger(value);
  } else if (decimalTypes.includes(type)) {
    valid = typeof value === "string" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
    if (valid && typeof value === "string" && column.precision != null) {
      const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
      const scale = column.scale ?? 0;
      valid =
        whole.replace(/^0+/, "").length <= column.precision - scale &&
        fraction.length <= scale;
    }
  } else if (floatTypes.includes(type)) {
    valid = typeof value === "number" && Number.isFinite(value);
    if (valid && postgres && ["real", "float4"].includes(type))
      valid =
        Number.isFinite(Math.fround(value as number)) &&
        (value === 0 || Math.fround(value as number) !== 0);
  } else if (type === "boolean" || type === "bool") {
    valid = postgres ? typeof value === "boolean" : value === 0 || value === 1;
  } else if (temporalTypes.includes(type)) {
    valid = typeof value === "string" && validDate(value, type, postgres);
  } else if (textTypes.includes(type)) {
    valid =
      typeof value === "string" &&
      !value.includes("\u0000") &&
      Buffer.from(value, "utf8").toString("utf8") === value;
    if (valid && type === "uuid")
      valid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        value as string,
      );
    if (valid && column.enum)
      valid = column.enum.map(String).includes(value as string);
  }
  if (!valid) {
    throw new PaginationInputError(
      external ? "INVALID_CURSOR" : "UNSUPPORTED_VALUE",
      `Unsupported boundary value for ${column.propertyPath} (${type})`,
    );
  }
  return value as CursorValue;
}
