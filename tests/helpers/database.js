import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Exercise the Worker's real SQL against SQLite, with D1's prepared/batch API.
export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql, values = []) => ({
    bind(...args) { return prepare(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
  });
  const DB = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, DB };
}
