# Task List Fixture

- [ ] First open task
- [x] Second done task
  - [ ] Nested open task
    - [x] Deeply nested done task
- [ ] Third open task

The checkbox toggle must be a byte-range splice — clicking any checkbox updates
only its `[ ]` or `[x]` characters in the source, never re-serializing the list.
