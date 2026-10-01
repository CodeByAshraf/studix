# React Component Testing Guidelines

When writing or fixing tests in this project:

1. **Testing Setup:**
   - Use `@testing-library/react` and `@testing-library/user-event` for UI interaction testing.
   - Prefer `screen.getByRole` or `screen.getByText` over test IDs or raw query selectors.

2. **Automated Verification:**
   - Always run the test suite (e.g., `npm test` or `npx vitest run`) after making logic changes.
   - If tests fail, read the terminal output, identify the breaking component, and refactor the code iteratively.

3. **Coverage Standards:**
   - Write tests covering key user flows, edge cases, and conditional renders.
   - Ensure async state changes are awaited properly with `waitFor` or `findBy*` queries.