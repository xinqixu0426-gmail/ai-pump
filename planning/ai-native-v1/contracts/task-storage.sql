-- DESIGN ONLY. N5 must assign a fresh migration number and integrate safe* helpers.
-- The referenced conversation tables already exist in the project; the audit creates mock parents only.
PRAGMA foreign_keys = ON;
CREATE TABLE ai_tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_key TEXT NOT NULL UNIQUE,
 parent_task_id INTEGER REFERENCES ai_tasks(id),
 owner_key TEXT NOT NULL,
 conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id),
 user_message_id INTEGER NOT NULL REFERENCES ai_conversation_messages(id),
 schema_version INTEGER NOT NULL CHECK(schema_version=2),
 revision INTEGER NOT NULL CHECK(revision>=1),
 plan_revision INTEGER NOT NULL CHECK(plan_revision>=1),
 state TEXT NOT NULL CHECK(state IN ('NEW','UNDERSTANDING','RESOLVING','RUNNING','WAITING_INPUT','WAITING_APPROVAL','VERIFYING','SUSPENDED','RECONCILING','SUCCEEDED','PARTIAL','UNSUPPORTED','FAILED','CANCELLED')),
 execution_mode TEXT NOT NULL CHECK(execution_mode IN ('FOREGROUND','DETACHED')),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
 budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 lease_owner TEXT, lease_token TEXT, lease_expires_at TEXT,
 cancel_requested_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 CHECK((lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX idx_ai_tasks_owner_state ON ai_tasks(owner_key,state,updated_at);
CREATE INDEX idx_ai_tasks_conversation ON ai_tasks(conversation_id,id);
CREATE TABLE ai_task_steps (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 step_key TEXT NOT NULL UNIQUE,
 task_id INTEGER NOT NULL REFERENCES ai_tasks(id),
 plan_revision INTEGER NOT NULL CHECK(plan_revision>=1),
 sequence INTEGER NOT NULL CHECK(sequence>=1),
 capability_id TEXT NOT NULL, tool_name TEXT NOT NULL,
 goal_keys_json TEXT NOT NULL CHECK(json_valid(goal_keys_json) AND json_type(goal_keys_json)='array'),
 access TEXT NOT NULL CHECK(access IN ('QUERY','PREVIEW','COMMAND')),
 args_json TEXT NOT NULL CHECK(json_valid(args_json)),
 args_hash TEXT NOT NULL CHECK(length(args_hash)=64),
 argument_sources_json TEXT NOT NULL CHECK(json_valid(argument_sources_json)),
 state TEXT NOT NULL CHECK(state IN ('PLANNED','RUNNING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN_EFFECT')),
 attempt INTEGER NOT NULL CHECK(attempt>=1),
 receipt_key TEXT, operation_id TEXT, idempotency_key TEXT,
 started_at TEXT, finished_at TEXT, error_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(task_id,plan_revision,sequence)
);
CREATE TABLE ai_task_evidence (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 evidence_key TEXT NOT NULL UNIQUE,
 task_id INTEGER NOT NULL REFERENCES ai_tasks(id),
 plan_revision INTEGER NOT NULL CHECK(plan_revision>=1),
 record_kind TEXT NOT NULL CHECK(record_kind IN ('RECEIPT','FACT')),
 receipt_key TEXT REFERENCES ai_task_evidence(evidence_key),
 fact_key_hash TEXT,
 supersedes_key TEXT REFERENCES ai_task_evidence(evidence_key),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 observed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((record_kind='RECEIPT' AND receipt_key IS NULL AND fact_key_hash IS NULL)
    OR (record_kind='FACT' AND receipt_key IS NOT NULL AND fact_key_hash IS NOT NULL))
);
CREATE INDEX idx_ai_task_evidence_fact ON ai_task_evidence(task_id,plan_revision,fact_key_hash,id);
CREATE TABLE ai_task_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id INTEGER NOT NULL REFERENCES ai_tasks(id),
 seq INTEGER NOT NULL CHECK(seq>=1),
 event_type TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(task_id,seq)
);
