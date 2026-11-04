import { createPage } from "./declaration-factory.js";

class User {
  id!: number;
}

// Declaration emission must name Paginated through the public package root.
export class UserPage extends createPage(User) {}
