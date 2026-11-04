// Both module systems use the same implementation and constructor instances.
import api from "./index.js";

export const {
  paginate,
  paginateRaw,
  CursorPaginator,
  PaginationInputError,
  Base64Transformer,
  JsonTransformer,
} = api;
export default api.paginate;
