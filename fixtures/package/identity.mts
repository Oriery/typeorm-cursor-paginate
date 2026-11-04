import { CursorPaginator, PaginationInputError } from "typeorm-cursor-paginate";
import {
  CursorPaginator as RequirePaginator,
  PaginationInputError as RequireError,
} from "./require-type.cjs";

// Private members reveal accidentally duplicated ESM and CJS class declarations.
const cjsClass: typeof CursorPaginator = RequirePaginator;
const esmClass: typeof RequirePaginator = CursorPaginator;
const cjsError: typeof PaginationInputError = RequireError;
const esmError: typeof RequireError = PaginationInputError;
