GFM table hardening (issue #61):

Alignment in every column:

| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |

Escaped pipes, emphasis, and code:

| Col | Escaped | Code |
|-----|---------|------|
| a \| b | *em* | `x` |
| p   | b \| c \| d | `y \| z` |

Links and hard breaks in cells:

| Name | Note |
|------|------|
| [site](https://example.com) | first line<br>second line |

Single column:

| Only |
|------|
| one  |

Empty cells:

| a |  | c |
|---|---|---|
| 1 |  | 3 |
