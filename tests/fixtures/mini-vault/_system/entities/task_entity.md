---
entity_name: task
extends: base
properties:
  status: { required: true }
  estimate: {}
  epic: {}
  owner: {}
  reviewer: {}
  stage: {}
  code: {}
  dod:
    required_unless:
      status: [Closed, Rejected]
---
