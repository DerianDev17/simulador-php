import { and, eq, ne, sql } from "drizzle-orm";
import { db, sqlite } from "@/db/client";
import {
  adminSessions,
  categories,
  questions,
  settings,
  stats,
  type Category,
  type CorrectOption,
  type Question,
  type Settings,
  type Stats
} from "@/db/schema";
import { hashPassword } from "./password";
import type { ParsedImportQuestion } from "./questionImport";
import { deleteQuestionImage } from "./uploads";

export type CategorySummary = Category & {
  questionCount: number;
};

export type QuestionWithCategory = Question & {
  categoryName: string;
};

export type QuestionInput = {
  categoryId: number;
  prompt: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: CorrectOption;
  imagePath?: string | null;
};

export type QuestionFilters = {
  categoryId?: number;
  search?: string;
};

export type QuizReportSummary = {
  totalAttempts: number;
  totalAnswered: number;
  totalCorrect: number;
  averageScore: number;
  averageDurationSeconds: number;
  completedToday: number;
  bestCategoryName: string | null;
  bestCategoryScore: number | null;
  weakestCategoryName: string | null;
  weakestCategoryScore: number | null;
};

export type RecentQuizAttempt = {
  id: string;
  categoryId: number;
  categoryName: string;
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  score: number;
  durationSeconds: number;
  finishedAt: string;
};

export type CategoryAttemptSummary = {
  categoryId: number;
  categoryName: string;
  attempts: number;
  averageScore: number;
  bestScore: number;
  weakestScore: number;
  totalQuestions: number;
  totalCorrect: number;
  lastFinishedAt: string;
};

export type QuestionImportSummary = {
  createdQuestions: number;
  skippedDuplicates: number;
  createdCategories: number;
};

function normalizeQuestionPrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").toLowerCase();
}

function attemptWhereClause(learnerId?: string, extraConditions: string[] = []): { clause: string; params: string[] } {
  const conditions = [...extraConditions];
  const params: string[] = [];

  if (learnerId) {
    conditions.unshift("learner_id = ?");
    params.push(learnerId);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

export function getSettings(): Settings | undefined {
  return db.select().from(settings).where(eq(settings.id, 1)).get();
}

export function ensureDefaultSettings(): Settings {
  const current = getSettings();
  if (current) {
    return current;
  }

  db.insert(settings)
    .values({
      id: 1,
      adminUsername: "admin",
      adminPasswordHash: hashPassword("admin"),
      questionsPerGame: 3
    })
    .run();

  return getSettings() as Settings;
}

export function updateSettings(input: {
  adminUsername: string;
  password?: string;
  questionsPerGame: number;
  preserveSessionId?: string;
}): void {
  const current = getSettings();
  const credentialsChanged =
    current?.adminUsername !== input.adminUsername || Boolean(input.password && input.password.length > 0);

  const values: Partial<typeof settings.$inferInsert> = {
    adminUsername: input.adminUsername,
    questionsPerGame: input.questionsPerGame,
    updatedAt: new Date().toISOString()
  };

  if (input.password && input.password.length > 0) {
    values.adminPasswordHash = hashPassword(input.password);
  }

  db.update(settings).set(values).where(eq(settings.id, 1)).run();

  if (credentialsChanged) {
    if (input.preserveSessionId) {
      db.delete(adminSessions).where(ne(adminSessions.id, input.preserveSessionId)).run();
    } else {
      db.delete(adminSessions).run();
    }
  }
}

export function getStats(): Stats {
  const current = db.select().from(stats).where(eq(stats.id, 1)).get();
  if (current) {
    return current;
  }

  db.insert(stats).values({ id: 1, visits: 0, answered: 0, completed: 0 }).run();
  return db.select().from(stats).where(eq(stats.id, 1)).get() as Stats;
}

export function incrementVisits(): void {
  db.update(stats)
    .set({ visits: sql`${stats.visits} + 1` })
    .where(eq(stats.id, 1))
    .run();
}

export function incrementAnswered(): void {
  db.update(stats)
    .set({ answered: sql`${stats.answered} + 1` })
    .where(eq(stats.id, 1))
    .run();
}

export function incrementCompleted(): void {
  db.update(stats)
    .set({ completed: sql`${stats.completed} + 1` })
    .where(eq(stats.id, 1))
    .run();
}

export function listCategorySummaries(): CategorySummary[] {
  return sqlite
    .prepare(
      `
      SELECT c.id, c.name, c.created_at AS createdAt, c.updated_at AS updatedAt, COUNT(q.id) AS questionCount
      FROM categories c
      LEFT JOIN questions q ON q.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE
    `
    )
    .all() as CategorySummary[];
}

export function listCategories(): Category[] {
  return db.select().from(categories).orderBy(categories.name).all();
}

export function getCategory(id: number): Category | undefined {
  return db.select().from(categories).where(eq(categories.id, id)).get();
}

export function createCategory(name: string): number {
  const result = db
    .insert(categories)
    .values({ name, updatedAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();

  if (result.changes > 0) {
    return Number(result.lastInsertRowid);
  }

  const existing = db.select().from(categories).where(eq(categories.name, name)).get();
  if (!existing) {
    throw new Error("No se pudo crear la categoria.");
  }

  return existing.id;
}

export function updateCategory(id: number, name: string): "updated" | "duplicate" | "not-found" {
  const current = getCategory(id);
  if (!current) {
    return "not-found";
  }

  const existing = db.select().from(categories).where(eq(categories.name, name)).get();
  if (existing && existing.id !== id) {
    return "duplicate";
  }

  db.update(categories)
    .set({
      name,
      updatedAt: new Date().toISOString()
    })
    .where(eq(categories.id, id))
    .run();

  return "updated";
}

export async function deleteCategoryAndImages(id: number): Promise<"deleted" | "not-found"> {
  const current = getCategory(id);
  if (!current) {
    return "not-found";
  }

  const categoryQuestions = getQuestionsForCategory(id);
  db.delete(categories).where(eq(categories.id, id)).run();

  await Promise.all(categoryQuestions.map((question) => deleteQuestionImage(question.imagePath)));
  return "deleted";
}

export function countQuestionsByCategory(categoryId: number): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(questions)
    .where(eq(questions.categoryId, categoryId))
    .get();
  return Number(row?.count ?? 0);
}

export function getTotalQuestions(): number {
  const row = db.select({ count: sql<number>`count(*)` }).from(questions).get();
  return Number(row?.count ?? 0);
}

export function listQuestions(filters: QuestionFilters = {}): QuestionWithCategory[] {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (filters.categoryId && Number.isInteger(filters.categoryId)) {
    where.push("q.category_id = ?");
    params.push(filters.categoryId);
  }

  const search = filters.search?.trim();
  if (search) {
    const value = `%${search}%`;
    where.push("(q.prompt LIKE ? OR q.option_a LIKE ? OR q.option_b LIKE ? OR q.option_c LIKE ? OR q.option_d LIKE ? OR c.name LIKE ?)");
    params.push(value, value, value, value, value, value);
  }

  return sqlite
    .prepare(
      `
      SELECT
        q.id,
        q.category_id AS categoryId,
        q.prompt,
        q.option_a AS optionA,
        q.option_b AS optionB,
        q.option_c AS optionC,
        q.option_d AS optionD,
        q.correct_option AS correctOption,
        q.image_path AS imagePath,
        q.created_at AS createdAt,
        q.updated_at AS updatedAt,
        c.name AS categoryName
      FROM questions q
      JOIN categories c ON c.id = q.category_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY q.id DESC
    `
    )
    .all(...params) as QuestionWithCategory[];
}

export function getQuizReportSummary(learnerId?: string): QuizReportSummary {
  const baseWhere = attemptWhereClause(learnerId);
  const totals = sqlite
    .prepare(
      `
      SELECT
        COUNT(*) AS totalAttempts,
        COALESCE(SUM(total_questions), 0) AS totalAnswered,
        COALESCE(SUM(correct_count), 0) AS totalCorrect,
        COALESCE(ROUND(AVG(score)), 0) AS averageScore,
        COALESCE(ROUND(AVG(duration_seconds)), 0) AS averageDurationSeconds
      FROM quiz_attempts
      ${baseWhere.clause}
    `
    )
    .get(...baseWhere.params) as Omit<QuizReportSummary, "completedToday" | "bestCategoryName" | "bestCategoryScore" | "weakestCategoryName" | "weakestCategoryScore">;

  const todayWhere = attemptWhereClause(learnerId, ["date(finished_at, 'localtime') = date('now', 'localtime')"]);
  const completedToday = sqlite
    .prepare(`SELECT COUNT(*) AS count FROM quiz_attempts ${todayWhere.clause}`)
    .get(...todayWhere.params) as { count: number };

  const best = sqlite
    .prepare(
      `
      SELECT category_name AS categoryName, ROUND(AVG(score)) AS averageScore
      FROM quiz_attempts
      ${baseWhere.clause}
      GROUP BY category_id, category_name
      ORDER BY AVG(score) DESC, COUNT(*) DESC, category_name COLLATE NOCASE
      LIMIT 1
    `
    )
    .get(...baseWhere.params) as { categoryName: string; averageScore: number } | undefined;

  const weakest = sqlite
    .prepare(
      `
      SELECT category_name AS categoryName, ROUND(AVG(score)) AS averageScore
      FROM quiz_attempts
      ${baseWhere.clause}
      GROUP BY category_id, category_name
      ORDER BY AVG(score) ASC, COUNT(*) DESC, category_name COLLATE NOCASE
      LIMIT 1
    `
    )
    .get(...baseWhere.params) as { categoryName: string; averageScore: number } | undefined;

  return {
    totalAttempts: Number(totals.totalAttempts),
    totalAnswered: Number(totals.totalAnswered),
    totalCorrect: Number(totals.totalCorrect),
    averageScore: Number(totals.averageScore),
    averageDurationSeconds: Number(totals.averageDurationSeconds),
    completedToday: Number(completedToday.count),
    bestCategoryName: best?.categoryName ?? null,
    bestCategoryScore: best ? Number(best.averageScore) : null,
    weakestCategoryName: weakest?.categoryName ?? null,
    weakestCategoryScore: weakest ? Number(weakest.averageScore) : null
  };
}

export function listRecentQuizAttempts(limit = 6, learnerId?: string): RecentQuizAttempt[] {
  const where = attemptWhereClause(learnerId);
  return sqlite
    .prepare(
      `
      SELECT
        id,
        category_id AS categoryId,
        category_name AS categoryName,
        total_questions AS totalQuestions,
        correct_count AS correctCount,
        incorrect_count AS incorrectCount,
        score,
        duration_seconds AS durationSeconds,
        finished_at AS finishedAt
      FROM quiz_attempts
      ${where.clause}
      ORDER BY finished_at DESC
      LIMIT ?
    `
    )
    .all(...where.params, limit) as RecentQuizAttempt[];
}

export function listCategoryAttemptSummaries(learnerId?: string): CategoryAttemptSummary[] {
  const where = attemptWhereClause(learnerId);
  return sqlite
    .prepare(
      `
      SELECT
        category_id AS categoryId,
        category_name AS categoryName,
        COUNT(*) AS attempts,
        ROUND(AVG(score)) AS averageScore,
        MAX(score) AS bestScore,
        MIN(score) AS weakestScore,
        SUM(total_questions) AS totalQuestions,
        SUM(correct_count) AS totalCorrect,
        MAX(finished_at) AS lastFinishedAt
      FROM quiz_attempts
      ${where.clause}
      GROUP BY category_id, category_name
      ORDER BY lastFinishedAt DESC, category_name COLLATE NOCASE
    `
    )
    .all(...where.params) as CategoryAttemptSummary[];
}

export function getQuestion(id: number): Question | undefined {
  return db.select().from(questions).where(eq(questions.id, id)).get();
}

export function getQuestionWithCategory(id: number): QuestionWithCategory | undefined {
  return sqlite
    .prepare(
      `
      SELECT
        q.id,
        q.category_id AS categoryId,
        q.prompt,
        q.option_a AS optionA,
        q.option_b AS optionB,
        q.option_c AS optionC,
        q.option_d AS optionD,
        q.correct_option AS correctOption,
        q.image_path AS imagePath,
        q.created_at AS createdAt,
        q.updated_at AS updatedAt,
        c.name AS categoryName
      FROM questions q
      JOIN categories c ON c.id = q.category_id
      WHERE q.id = ?
    `
    )
    .get(id) as QuestionWithCategory | undefined;
}

export function createQuestion(input: QuestionInput): number {
  const result = db.insert(questions).values(input).run();
  return Number(result.lastInsertRowid);
}

export function importQuestionRows(rows: ParsedImportQuestion[]): QuestionImportSummary {
  const importRows = sqlite.transaction(() => {
    const categoryIds = new Map(listCategories().map((category) => [category.name.trim().toLowerCase(), category.id]));
    const summary: QuestionImportSummary = {
      createdQuestions: 0,
      skippedDuplicates: 0,
      createdCategories: 0
    };

    for (const row of rows) {
      const categoryKey = row.categoryName.trim().toLowerCase();
      let categoryId = categoryIds.get(categoryKey);

      if (!categoryId) {
        categoryId = createCategory(row.categoryName);
        categoryIds.set(categoryKey, categoryId);
        summary.createdCategories += 1;
      }

      const duplicate = findQuestionByCategoryAndPrompt(categoryId, row.prompt);
      if (duplicate) {
        summary.skippedDuplicates += 1;
        continue;
      }

      createQuestion({
        categoryId,
        prompt: row.prompt,
        optionA: row.optionA,
        optionB: row.optionB,
        optionC: row.optionC,
        optionD: row.optionD,
        correctOption: row.correctOption
      });
      summary.createdQuestions += 1;
    }

    return summary;
  });

  return importRows();
}

export function findQuestionByCategoryAndPrompt(categoryId: number, prompt: string, excludeId?: number): Question | undefined {
  const normalizedPrompt = normalizeQuestionPrompt(prompt);
  return getQuestionsForCategory(categoryId).find(
    (question) => question.id !== excludeId && normalizeQuestionPrompt(question.prompt) === normalizedPrompt
  );
}

export function updateQuestion(id: number, input: QuestionInput): void {
  db.update(questions)
    .set({
      ...input,
      updatedAt: new Date().toISOString()
    })
    .where(eq(questions.id, id))
    .run();
}

export function deleteQuestion(id: number): void {
  db.delete(questions).where(eq(questions.id, id)).run();
}

export async function deleteQuestionAndImage(id: number): Promise<void> {
  const question = getQuestion(id);
  db.delete(questions).where(eq(questions.id, id)).run();
  await deleteQuestionImage(question?.imagePath);
}

export function getQuestionsForCategory(categoryId: number): Question[] {
  return db.select().from(questions).where(eq(questions.categoryId, categoryId)).all();
}

export function getQuestionsByIds(ids: number[]): Question[] {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(",");
  return sqlite
    .prepare(
      `
      SELECT
        id,
        category_id AS categoryId,
        prompt,
        option_a AS optionA,
        option_b AS optionB,
        option_c AS optionC,
        option_d AS optionD,
        correct_option AS correctOption,
        image_path AS imagePath,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM questions
      WHERE id IN (${placeholders})
    `
    )
    .all(...ids) as Question[];
}

export function findQuestionInCategory(questionId: number, categoryId: number): Question | undefined {
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.categoryId, categoryId)))
    .get();
}
