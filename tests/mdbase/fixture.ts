import { loadSchema } from "../../src/schema.js";
import type { RawFile } from "../../src/types.js";

/** Minimal two-tier fixture: base ← task / page, properties by name. */
export function fixtureSchema() {
  const props: RawFile[] = [
    { path: "properties/type_key_property.md", content: "---\nproperty_name: type_key\nproperty_type: string\n---\n" },
    { path: "properties/status_property.md", content: "---\nproperty_name: status\nproperty_type: enum\nallowed_values: [Backlog, Done, Closed, Rejected]\n---\n" },
    { path: "properties/priority_property.md", content: "---\nproperty_name: priority\nproperty_type: enum\nallowed_values: [High, 1, 2]\n---\n" },
    { path: "properties/estimate_property.md", content: "---\nproperty_name: estimate\nproperty_type: number\nmin_value: 1\nmax_value: 360\n---\n" },
    { path: "properties/time_budget_property.md", content: "---\nproperty_name: time_budget\nproperty_type: number\nnullable: true\n---\n" },
    { path: "properties/epic_property.md", content: "---\nproperty_name: epic\nproperty_type: links\ntarget_type_key: epic\n---\n" },
    { path: "properties/tags_property.md", content: "---\nproperty_name: tags\nproperty_type: list\n---\n" },
    { path: "properties/dod_property.md", content: "---\nproperty_name: dod\nproperty_type: any\n---\n" },
    { path: "properties/created_property.md", content: "---\nproperty_name: created\nproperty_type: date\n---\n" },
    { path: "properties/done_property.md", content: "---\nproperty_name: done\nproperty_type: boolean\n---\n" },
  ];
  const entities: RawFile[] = [
    { path: "entities/base_entity.md", content: "---\nentity_name: base\nproperties:\n  type_key: {required: true}\n  tags: {}\n---\n" },
    {
      path: "entities/task_entity.md",
      content:
        "---\nentity_name: task\nextends: base\nproperty_patterns: ['^time_[a-z]+$']\nproperties:\n  status: {required: true}\n  priority: {}\n  estimate: {}\n  epic: {}\n  created: {required: true}\n  done: {}\n  dod:\n    required_unless:\n      status: [Closed, Rejected]\n---\n",
    },
    { path: "entities/page_entity.md", content: "---\nentity_name: page\nextends: base\nallow_extra: true\nproperties:\n  time_budget: {}\n  unknown_prop: {}\n---\n" },
  ];
  return loadSchema(entities, props);
}
