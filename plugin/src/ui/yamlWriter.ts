/** Quote YAML scalar values that contain special characters */
function yamlScalar(val: string | number): string {
  const s = String(val);
  if (
    s.includes(":") ||
    s.includes("#") ||
    s.includes("'") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.startsWith(" ") ||
    s.endsWith(" ") ||
    s === "" ||
    s === "true" ||
    s === "false" ||
    s === "null"
  ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Generate entity file frontmatter content */
export function generateEntityFrontmatter(
  allowExtra: boolean,
  properties: Record<string, { required?: boolean }>,
): string {
  const lines: string[] = ["---", "component_type: entity"];

  if (allowExtra) {
    lines.push("allow_extra: true");
  }

  const entries = Object.entries(properties);
  if (entries.length > 0) {
    lines.push("properties:");
    for (const [name, config] of entries) {
      if (config.required) {
        lines.push(`  ${name}:`);
        lines.push(`    required: true`);
      } else {
        lines.push(`  ${name}: {}`);
      }
    }
  }

  lines.push("---", "");
  return lines.join("\n");
}

/** Generate property file frontmatter content */
export function generatePropertyFrontmatter(
  type: string,
  opts?: {
    allowed_values?: (string | number)[];
    min_value?: number;
    max_value?: number;
    unit?: string;
    custom_validator?: string;
    link_constraints?: {
      target_type_key?: string;
      target_folder?: string;
      target_has_property?: string;
      target_property_value?: { property: string; value: string };
    };
  },
): string {
  const lines: string[] = ["---", `property_type: ${type}`];

  if (opts?.allowed_values && opts.allowed_values.length > 0) {
    lines.push("allowed_values:");
    for (const val of opts.allowed_values) {
      lines.push(`  - ${yamlScalar(val)}`);
    }
  }

  if (opts?.min_value != null) {
    lines.push(`min_value: ${opts.min_value}`);
  }

  if (opts?.max_value != null) {
    lines.push(`max_value: ${opts.max_value}`);
  }

  if (opts?.unit) {
    lines.push(`unit: ${yamlScalar(opts.unit)}`);
  }

  if (opts?.link_constraints) {
    const lc = opts.link_constraints;
    if (lc.target_type_key) {
      lines.push(`target_type_key: ${yamlScalar(lc.target_type_key)}`);
    }
    if (lc.target_folder) {
      lines.push(`target_folder: ${yamlScalar(lc.target_folder)}`);
    }
    if (lc.target_has_property) {
      lines.push(`target_has_property: ${yamlScalar(lc.target_has_property)}`);
    }
    if (lc.target_property_value) {
      lines.push(`target_property_value:`);
      lines.push(`  property: ${yamlScalar(lc.target_property_value.property)}`);
      lines.push(`  value: ${yamlScalar(lc.target_property_value.value)}`);
    }
  }

  if (opts?.custom_validator) {
    lines.push(`custom_validator: ${yamlScalar(opts.custom_validator)}`);
  }

  lines.push("---", "");
  return lines.join("\n");
}
