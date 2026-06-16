import type Database from "better-sqlite3";

function columnExists(sqlite: Database.Database, table: string, column: string): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

export function runMigrations(sqlite: Database.Database): void {
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT NOT NULL,
      admin_password_hash TEXT NOT NULL,
      questions_per_game INTEGER NOT NULL DEFAULT 3,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS categories_name_idx ON categories(name);

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
      image_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS questions_category_idx ON questions(category_id);

    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visits INTEGER NOT NULL DEFAULT 0,
      answered INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT NOT NULL,
      attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS login_attempts_identifier_idx ON login_attempts(identifier, attempted_at);

    CREATE TABLE IF NOT EXISTS game_sessions (
      id TEXT PRIMARY KEY,
      learner_id TEXT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      question_ids TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '[]',
      current_index INTEGER NOT NULL DEFAULT 0,
      current_token TEXT NOT NULL,
      correct_count INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      learner_id TEXT,
      category_id INTEGER NOT NULL,
      category_name TEXT NOT NULL,
      total_questions INTEGER NOT NULL,
      correct_count INTEGER NOT NULL,
      incorrect_count INTEGER NOT NULL,
      score INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS quiz_attempts_finished_at_idx ON quiz_attempts(finished_at);
    CREATE INDEX IF NOT EXISTS quiz_attempts_category_idx ON quiz_attempts(category_id);

    CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL,
      question_prompt TEXT NOT NULL,
      question_image_path TEXT,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      selected_option TEXT NOT NULL CHECK (selected_option IN ('A', 'B', 'C', 'D')),
      selected_label TEXT NOT NULL,
      correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
      correct_label TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      answer_order INTEGER NOT NULL,
      answered_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS quiz_attempt_answers_attempt_idx ON quiz_attempt_answers(attempt_id);
  `);

  const statsRow = sqlite.prepare("SELECT id FROM stats WHERE id = 1").get();
  if (!statsRow) {
    sqlite.prepare("INSERT INTO stats (id, visits, answered, completed) VALUES (1, 0, 0, 0)").run();
  }

  if (!columnExists(sqlite, "game_sessions", "current_token")) {
    sqlite.prepare("ALTER TABLE game_sessions ADD COLUMN current_token TEXT NOT NULL DEFAULT ''").run();
    sqlite.prepare("UPDATE game_sessions SET current_token = lower(hex(randomblob(16))) WHERE current_token = ''").run();
  }

  if (!columnExists(sqlite, "game_sessions", "answers")) {
    sqlite.prepare("ALTER TABLE game_sessions ADD COLUMN answers TEXT NOT NULL DEFAULT '[]'").run();
  }

  if (!columnExists(sqlite, "game_sessions", "learner_id")) {
    sqlite.prepare("ALTER TABLE game_sessions ADD COLUMN learner_id TEXT").run();
  }

  if (!columnExists(sqlite, "quiz_attempts", "learner_id")) {
    sqlite.prepare("ALTER TABLE quiz_attempts ADD COLUMN learner_id TEXT").run();
  }

  sqlite.prepare("CREATE INDEX IF NOT EXISTS quiz_attempts_learner_idx ON quiz_attempts(learner_id)").run();
}
