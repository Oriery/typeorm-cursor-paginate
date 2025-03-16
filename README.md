# TypeORM Paginator

// TODO update links to point to the new repo
// TODO write that this is a fork of the original repo
// TODO write description with important original features

<p>
  <a href="https://npmcharts.com/compare/todo-package-name?minimal=true"><img alt="Downloads" src="https://img.shields.io/npm/dt/todo-package-name.svg?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/todo-package-name"><img alt="License" src="https://img.shields.io/npm/l/todo-package-name.svg?style=flat-square" /></a>
</p>

Cursor-based pagination that works with [TypeORM Query Builder](https://typeorm.io/#/select-query-builder). Read about the general idea of cursor-based pagination [here](https://jsonapi.org/profiles/ethanresnick/cursor-pagination/).

This package is a fork of the [typeorm-paginator](https://www.npmjs.com/package/typeorm-paginator) package with some tweaks.

Unlike the original package, this one implements **directional** cursors. Directional cursors store the direction of pagination inside. They allow to provide only one parameter to paginate in any direction.

- [Installation](#installation)
- [Usage](#usage)
  - [Configuration](#configuration)
  - [Paginating Results](#paginating-results)
    - [Retrieving the First Page](#retrieving-the-first-page)
    - [Navigating to the Next Page](#navigating-to-the-next-page)
- [Key differences from the original package](#key-differences-from-the-original-package)


## Installation

```bash
npm install todo-package-name --save
```

## Usage

Start by importing the `CursorPaginator` class:

```typescript
import { CursorPaginator } from "todo-package-name";
```

### Configuration

Instantiate the paginator with your target entity and define the ordering strategy. In this example, users are sorted by their `name` in ascending order and by `id` in descending order:

```typescript
const paginator = new CursorPaginator(User, {
  orderBy: [
    { name: 'ASC' },
    { id: 'DESC' },
  ],
});
```

Prepare your query:

```typescript
const query = repoUsers.createQueryBuilder();
// you can apply desired "where" conditions to the query
```

### Paginating Results

#### Retrieving the First Page

Use the paginator to fetch the initial set of results. Here, a limit of 2 items per page is specified:

```typescript
const firstPageResult = await paginator.paginate(query, { limit: 2 });
```

Output structure:

```typescript
{
  nodes: [
    User { id: 4, name: 'a' },
    User { id: 3, name: 'b' },
  ],
  hasPrevPage: false,
  hasNextPage: true,
  prevPageCursor: "some-cursor-string",
  nextPageCursor: "some-cursor-string",
}
```

#### Navigating to the Next Page

To retrieve the next set of results, pass the `nextPageCursor` from the first query:

```typescript
const secondPageResult = await paginator.paginate(query, { 
  limit: 2,
  // Use the nextPageCursor from the previous result
  pageCursor: firstPageResult.nextPageCursor 
});
```

Output structure:

```typescript
{
  nodes: [
    User { id: 1, name: 'c' },
    User { id: 2, name: 'c' },
  ],
  hasPrevPage: true,
  hasNextPage: true,
  prevPageCursor: "some-cursor-string",
  nextPageCursor: "some-cursor-string",
}
```

## Key differences from the original package

- **Directional cursors**: In the original package, cursors are not directional. The pagination direction was determined by what argument the cursor is passed to.
  This package stores the direction of pagination inside the cursor. It allows to provide only one parameter to paginate in any direction.
- **Type safety**: Added some more type safety to the code. Now the `orderBy` property only accepts keys that are present in the entity.
- **Removed PageCursor**: The `PageCursor` class was removed. This package is about cursor-based pagination.
- **No default "limit"**: Original package had a default limit of 20.Now, if the limit is omitted, all results will be returned.
