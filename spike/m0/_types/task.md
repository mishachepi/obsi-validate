---
kind: mdbase.type
name: task
version: 1
schema:
  dialect: json-schema-2020-12
  value:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    required: [type_key, status, created]
    properties:
      type_key: { const: task }
      status: { enum: [Backlog, Planned, To Do, In Progress, Done, Closed, Rejected, Draft] }
      priority: { type: [string, number], enum: [High, Medium, Low, 1, 2, 3, 4, 5] }
      estimate: { type: number, minimum: 1 }
      created: { type: string }
      due: { type: string }
      epic: { type: [string, array], items: { type: string } }
      assignee: { type: [string, array], items: { type: string } }
      dod: { type: string }
      tags: { type: [array, string, number, boolean] }
    additionalProperties: false
    # required_unless: dod required unless status in [Closed, Rejected, Draft]
    if:
      properties:
        status: { enum: [Closed, Rejected, Draft] }
    then: {}
    else:
      required: [dod]
collection:
  links:
    epic:
      target_type: epic
      validate_exists: true
---
# task (M0 smoke)
