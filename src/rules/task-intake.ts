/** Task-intake rule: tasks created on or after the cutoff must come from the
 * task-capture tool, which writes a full `created` timestamp, exactly one
 * `created_by` author link and an `epic` or `area` anchor. Older tasks, and
 * tasks without a parseable `created`, are exempt. A new task that omits
 * `created` escapes the rule; `created: {required: true}` on the task entity
 * closes that gap. */
import { rawFrontmatterValue } from "../frontmatter.js";
import type { ValidationError } from "../types.js";
import { asList } from "../values.js";

/** Entity type the rule applies to. */
export const TASK_ENTITY = "task";

/** Tasks created at or after this moment are checked. The offset pins it to
 * local midnight, not UTC. */
export const TASK_INTAKE_CUTOFF = new Date("2026-08-18T00:00:00+02:00");

const HINT = "create tasks with the task-capture tool (see the obsi-tasks skill)";

function createdAt(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Errors for a task note that breaks the intake rule; [] when it complies or is exempt. */
export function validateTaskIntake(content: string, data: Record<string, unknown>): ValidationError[] {
  const created = createdAt(data["created"]);
  if (!created || created < TASK_INTAKE_CUTOFF) return [];

  const errors: ValidationError[] = [];
  const rawCreated = rawFrontmatterValue(content, "created");
  if (!rawCreated || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawCreated)) {
    errors.push({
      field: "created",
      message: `created must be a full ISO timestamp with time — ${HINT}`,
      received: rawCreated,
    });
  }
  if (asList(data["created_by"]).length !== 1) {
    errors.push({
      field: "created_by",
      message: `created_by must hold exactly one author link — ${HINT}`,
      received: data["created_by"] ?? null,
    });
  }
  if (asList(data["epic"]).length === 0 && asList(data["area"]).length === 0) {
    errors.push({
      field: "epic",
      message: `epic or area is required — ${HINT}`,
      received: data["epic"] ?? null,
    });
  }
  return errors;
}
