# Self Learning Skill Quality Judge

Evaluate whether a generated `SKILL.md` captures reusable guidance from the source conversation and can improve a similar future task.

Return JSON with these numeric fields from 0 to 1:

- `correctness`
- `clarity`
- `reusability`
- `specificity`
- `safety_verification`

Also return:

- `reason`: concise explanation
- `missing_or_weak`: array of weak or missing elements

Use the hard-check results as format evidence, but judge the skill content independently. Penalize overfitting to one local machine, credentials, unsafe commands, missing verification, or guidance that is too vague to reuse.
