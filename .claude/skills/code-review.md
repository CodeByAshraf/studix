# Code Review Guidelines for React & TypeScript

When asked to review code in this project, inspect the following:

1. **React Best Practices:**
   - Ensure components use functional patterns and custom hooks appropriately.
   - Verify proper use of `useMemo` and `useCallback` to prevent unnecessary re-renders.
   - Check that props are strictly typed with TypeScript interfaces or types.

2. **Performance & Clean Code:**
   - Avoid inline functions inside render JSX where performance matters.
   - Ensure state updates are clean and free from race conditions.
   - Validate proper cleanup in `useEffect` hooks.

3. **Error Handling & UX:**
   - Check for missing loading or error states in asynchronous UI components.
   - Ensure sensitive data or unhandled API errors are caught gracefully.