// Browsers use different messages for rejected import() fetches. These need
// a fresh page; resetting a render boundary leaves cached loader state intact.
export const isModuleLoadFailure = (error: Error): boolean =>
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script/i.test(
    error.message,
  );
