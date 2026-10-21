/** mdbase's JSON-Schema validator on its own.
 *
 * The package's `exports` map only exposes the whole library (CEL, sql.js,
 * migrations), which costs ~150 ms to load on every CLI call; this module
 * needs only ajv and loads in ~20 ms. The file path is tied to the exactly
 * pinned package version, and tests/mdbase/json-schema.test.ts checks that it
 * is the very function the package exports. */
export { validateJsonSchemaFrontmatter } from "../../node_modules/@callumalpass/mdbase/dist/validation/json-schema.js";
