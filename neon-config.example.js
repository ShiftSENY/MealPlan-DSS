// Copy this file to `neon-config.js` and paste your own Neon connection string.
// The real `neon-config.js` is listed in .gitignore and must not be committed
// if this repository is public.
//
// Find the connection string in the Neon dashboard:
//   Project -> Dashboard -> Connection string (choose "Pooled connection")
//
// Example shape (yours will differ):
//   postgresql://neondb_owner:AbCdEf123456@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require

export const NEON_CONNECTION_STRING =
  "postgresql://user:REPLACE_ME@ep-REPLACE_ME.region.aws.neon.tech/neondb?sslmode=require";
