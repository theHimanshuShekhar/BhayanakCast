import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterEach, expect, test } from 'vitest'
import { createServerRuntime } from '../../src/server/runtime'
import { getIntegrationContext } from '../setup/integration'
const APPLICATION_SCHEMA = {
  user: {
    columns: {
      all_access_blocked_indefinite: 'boolean',
      all_access_blocked_until: 'timestamp without time zone',
      created_at: 'timestamp without time zone',
      email: 'text',
      email_verified: 'boolean',
      id: 'text',
      image: 'text',
      name: 'text',
      updated_at: 'timestamp without time zone',
    },
    indexes: [],
    constraints: ['user_email_unique', 'user_pkey'],
  },
  room: {
    columns: {
      category: 'text',
      created_at: 'timestamp without time zone',
      created_by: 'text',
      description: 'text',
      empty_at: 'timestamp without time zone',
      ended_at: 'timestamp without time zone',
      id: 'uuid',
      name: 'text',
      password_hash: 'text',
      tags: 'ARRAY',
      visibility: 'text',
      warning_1_sent_at: 'timestamp without time zone',
      warning_10_sent_at: 'timestamp without time zone',
      warning_30_sent_at: 'timestamp without time zone',
    },
    indexes: ['room_active_activity_idx'],
    constraints: [
      'room_created_by_user_id_fk',
      'room_end_check',
      'room_password_check',
      'room_pkey',
      'room_tag_count_check',
      'room_visibility_check',
    ],
  },
  room_membership: {
    columns: {
      account_id: 'text',
      id: 'uuid',
      joined_at: 'timestamp without time zone',
      left_at: 'timestamp without time zone',
      reconnect_until: 'timestamp without time zone',
      role: 'text',
      room_id: 'uuid',
    },
    indexes: [
      'room_membership_current_room_idx',
      'room_membership_one_current_account_idx',
      'room_membership_one_current_host_idx',
    ],
    constraints: [
      'room_membership_account_id_user_id_fk',
      'room_membership_id_room_unique',
      'room_membership_interval_check',
      'room_membership_pkey',
      'room_membership_role_check',
      'room_membership_room_id_room_id_fk',
    ],
  },
  message: {
    columns: {
      body: 'text',
      created_at: 'timestamp without time zone',
      id: 'uuid',
      membership_id: 'uuid',
      mutation_id: 'uuid',
      room_id: 'uuid',
    },
    indexes: ['message_membership_mutation_idx', 'message_room_recent_idx'],
    constraints: [
      'message_body_length_check',
      'message_membership_room_fk',
      'message_pkey',
      'message_room_id_fkey',
    ],
  },
  report: {
    columns: {
      created_at: 'timestamp without time zone',
      details: 'text',
      evidence_captured_at: 'timestamp without time zone',
      evidence_content: 'bytea',
      evidence_content_type: 'text',
      id: 'uuid',
      reason: 'text',
      reporter_account_id: 'text',
      reporter_subject_ref: 'uuid',
      resolved_at: 'timestamp without time zone',
      resolved_by_account_id: 'text',
      retain_until: 'timestamp without time zone',
      room_id: 'uuid',
      status: 'text',
      subject_ref: 'uuid',
      target_id: 'text',
      target_type: 'text',
    },
    indexes: ['report_queue_idx', 'report_status_queue_idx'],
    constraints: [
      'report_details_check',
      'report_details_length_check',
      'report_evidence_check',
      'report_pkey',
      'report_reason_check',
      'report_reporter_fk',
      'report_reporter_subject_check',
      'report_reporter_subject_ref_fk',
      'report_resolution_check',
      'report_resolved_by_fk',
      'report_room_fk',
      'report_status_check',
      'report_subject_ref_fk',
      'report_target_subject_check',
      'report_target_type_check',
    ],
  },
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function unmigratedSchema() {
  const context = await getIntegrationContext()
  const schema = `startup_${randomUUID().replaceAll('-', '')}`.slice(0, 60)
  const admin = new Pool({ connectionString: context.environment.databaseUrl })
  cleanups.push(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  })
  const runtime = () =>
    createServerRuntime({
      DATABASE_URL: context.environment.databaseUrl,
      DATABASE_SCHEMA: schema,
    } as NodeJS.ProcessEnv)
  const tables = async () => {
    const observed = await admin.query<{ name: string }>(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1',
      [schema],
    )
    return observed.rows.map((row) => row.name)
  }
  const applicationSchema = async () => {
    const columns = await admin.query<{
      tableName: string
      columnName: string
      dataType: string
    }>(
      `SELECT table_name AS "tableName",
              column_name AS "columnName",
              data_type AS "dataType"
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = ANY($2::text[])
        ORDER BY table_name, column_name`,
      [schema, Object.keys(APPLICATION_SCHEMA)],
    )
    const indexes = await admin.query<{ tableName: string; name: string }>(
      `SELECT table_class.relname AS "tableName", index_class.relname AS name
         FROM pg_catalog.pg_class table_class
         JOIN pg_catalog.pg_namespace namespace
           ON namespace.oid = table_class.relnamespace
         JOIN pg_catalog.pg_index index_definition
           ON index_definition.indrelid = table_class.oid
         JOIN pg_catalog.pg_class index_class
           ON index_class.oid = index_definition.indexrelid
         LEFT JOIN pg_catalog.pg_constraint constraint_definition
           ON constraint_definition.conindid = index_class.oid
        WHERE namespace.nspname = $1
          AND table_class.relname = ANY($2::text[])
          AND constraint_definition.oid IS NULL
        ORDER BY table_class.relname, index_class.relname`,
      [schema, Object.keys(APPLICATION_SCHEMA)],
    )
    const constraints = await admin.query<{ tableName: string; name: string }>(
      `SELECT table_class.relname AS "tableName",
              constraint_definition.conname AS name
         FROM pg_catalog.pg_constraint constraint_definition
         JOIN pg_catalog.pg_class table_class
           ON table_class.oid = constraint_definition.conrelid
         JOIN pg_catalog.pg_namespace namespace
           ON namespace.oid = table_class.relnamespace
        WHERE namespace.nspname = $1
          AND table_class.relname = ANY($2::text[])
          AND constraint_definition.contype <> 'n'
        ORDER BY table_class.relname, constraint_definition.conname`,
      [schema, Object.keys(APPLICATION_SCHEMA)],
    )
    return { columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows }
  }
  return { runtime, tables, applicationSchema }
}

test('startup provisions and migrates a schema that does not exist yet', async () => {
  const subject = await unmigratedSchema()
  expect(await subject.tables()).toEqual([])

  const runtime = subject.runtime()
  await runtime.migrate()
  await runtime.close()

  const observed = await subject.applicationSchema()
  for (const [tableName, expected] of Object.entries(APPLICATION_SCHEMA)) {
    expect(
      Object.fromEntries(
        observed.columns
          .filter((column) => column.tableName === tableName)
          .map((column) => [column.columnName, column.dataType]),
      ),
      `columns and types for ${tableName}`,
    ).toEqual(expected.columns)
    expect(
      observed.indexes
        .filter((index) => index.tableName === tableName)
        .map((index) => index.name),
      `indexes for ${tableName}`,
    ).toEqual(expected.indexes)
    expect(
      observed.constraints
        .filter((constraint) => constraint.tableName === tableName)
        .map((constraint) => constraint.name),
      `constraints for ${tableName}`,
    ).toEqual(expected.constraints)
  }
})

test('a second startup against a current schema changes nothing', async () => {
  const subject = await unmigratedSchema()
  const first = subject.runtime()
  await first.migrate()
  await first.close()
  const before = (await subject.tables()).sort()

  const second = subject.runtime()
  await second.migrate()
  await second.close()

  expect((await subject.tables()).sort()).toEqual(before)
})
