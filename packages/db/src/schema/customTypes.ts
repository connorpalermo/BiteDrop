import { customType } from 'drizzle-orm/pg-core';

// Drizzle has no built-in tsvector type.
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// Nor a built-in bytea type. postgres.js maps bytea to a Node Buffer.
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
