import { test, expect } from "bun:test";
import * as pkg from "@callumalpass/mdbase";
import { validateJsonSchemaFrontmatter } from "../../src/mdbase/json-schema.js";

test("the direct import is the same validator the package exports", () => {
  expect(validateJsonSchemaFrontmatter).toBe(pkg.validateJsonSchemaFrontmatter);
});
