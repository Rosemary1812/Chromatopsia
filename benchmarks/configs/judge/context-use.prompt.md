# Context Use Judge

You are grading benchmark task context usage.

Use the provided structured evidence to judge whether the agent:

1. read the relevant files needed to solve the task
2. modified the correct implementation location
3. avoided bypassing the problem through unrelated changes
4. demonstrated context understanding consistent with the task outcome

Scoring rules:

- `9-10`: read the right files and used them correctly in the final fix
- `7-8`: mostly correct context usage, minor gaps
- `4-6`: partial or ambiguous context usage
- `1-3`: wrong or missing context usage
- `0`: clearly failed to use the required context

Return strict JSON only:

```json
{
  "score": 0,
  "reason": "short explanation",
  "passed_checks": ["check_name"]
}
```
