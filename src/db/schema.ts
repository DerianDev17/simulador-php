import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminUsername: text("admin_username").notNull(),
  adminPasswordHash: text("admin_password_hash").notNull(),
  questionsPerGame: integer("questions_per_game").notNull().default(3),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [uniqueIndex("categories_name_idx").on(table.name)]
);

export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  optionA: text("option_a").notNull(),
  optionB: text("option_b").notNull(),
  optionC: text("option_c").notNull(),
  optionD: text("option_d").notNull(),
  correctOption: text("correct_option", { enum: ["A", "B", "C", "D"] }).notNull(),
  imagePath: text("image_path"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const stats = sqliteTable("stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  visits: integer("visits").notNull().default(0),
  answered: integer("answered").notNull().default(0),
  completed: integer("completed").notNull().default(0)
});

export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(),
  csrfToken: text("csrf_token").notNull(),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull()
});

export const loginAttempts = sqliteTable("login_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  identifier: text("identifier").notNull(),
  attemptedAt: text("attempted_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const gameSessions = sqliteTable("game_sessions", {
  id: text("id").primaryKey(),
  learnerId: text("learner_id"),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  questionIds: text("question_ids").notNull(),
  answers: text("answers").notNull().default("[]"),
  currentIndex: integer("current_index").notNull().default(0),
  currentToken: text("current_token").notNull(),
  correctCount: integer("correct_count").notNull().default(0),
  completed: integer("completed").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull()
});

export const quizAttempts = sqliteTable(
  "quiz_attempts",
  {
    id: text("id").primaryKey(),
    learnerId: text("learner_id"),
    categoryId: integer("category_id").notNull(),
    categoryName: text("category_name").notNull(),
    totalQuestions: integer("total_questions").notNull(),
    correctCount: integer("correct_count").notNull(),
    incorrectCount: integer("incorrect_count").notNull(),
    score: integer("score").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
    durationSeconds: integer("duration_seconds").notNull()
  },
  (table) => [
    index("quiz_attempts_finished_at_idx").on(table.finishedAt),
    index("quiz_attempts_category_idx").on(table.categoryId),
    index("quiz_attempts_learner_idx").on(table.learnerId)
  ]
);

export const quizAttemptAnswers = sqliteTable(
  "quiz_attempt_answers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: integer("question_id").notNull(),
    questionPrompt: text("question_prompt").notNull(),
    questionImagePath: text("question_image_path"),
    optionA: text("option_a").notNull(),
    optionB: text("option_b").notNull(),
    optionC: text("option_c").notNull(),
    optionD: text("option_d").notNull(),
    selectedOption: text("selected_option", { enum: ["A", "B", "C", "D"] }).notNull(),
    selectedLabel: text("selected_label").notNull(),
    correctOption: text("correct_option", { enum: ["A", "B", "C", "D"] }).notNull(),
    correctLabel: text("correct_label").notNull(),
    isCorrect: integer("is_correct").notNull().default(0),
    answerOrder: integer("answer_order").notNull(),
    answeredAt: text("answered_at").notNull()
  },
  (table) => [index("quiz_attempt_answers_attempt_idx").on(table.attemptId)]
);

export type CorrectOption = "A" | "B" | "C" | "D";
export type Category = typeof categories.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Stats = typeof stats.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type QuizAttemptAnswer = typeof quizAttemptAnswers.$inferSelect;
