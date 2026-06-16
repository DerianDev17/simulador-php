import { and, eq, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, sqlite } from "@/db/client";
import {
  gameSessions,
  quizAttemptAnswers,
  quizAttempts,
  type CorrectOption,
  type GameSession,
  type Question,
  type QuizAttempt,
  type QuizAttemptAnswer
} from "@/db/schema";
import type { CookieJar } from "./cookies";
import { secureCookie } from "./cookies";
import {
  findQuestionInCategory,
  getCategory,
  getQuestionsByIds,
  getQuestionsForCategory,
  incrementAnswered,
  incrementCompleted
} from "./store";

export const gameSessionCookie = "eus_game_session";
const gameHours = 4;

export type GameAnswer = {
  questionId: number;
  selectedOption: CorrectOption;
  correctOption: CorrectOption;
  isCorrect: boolean;
  order: number;
  answeredAt: string;
};

export type ErrorReviewQuestion = {
  order: number;
  question: Question;
  selectedOption: CorrectOption;
  selectedLabel: string;
  correctOption: CorrectOption;
  correctLabel: string;
};

export type GameDetailQuestion = ErrorReviewQuestion & {
  isCorrect: boolean;
};

export type CompletedGameRef = {
  id: string;
  categoryId: number;
  startedAt: string;
  finishedAt: string;
};

export type GameState =
  | {
      status: "ready";
      game: GameSession;
      categoryName: string;
      question: Question;
      currentNumber: number;
      totalQuestions: number;
      answerToken: string;
    }
  | {
      status: "insufficient";
      categoryName: string;
      availableQuestions: number;
      requiredQuestions: number;
    }
  | {
      status: "missing-category";
    };

export type GameResult =
  | {
      status: "ready";
      game: CompletedGameRef;
      categoryName: string;
      correct: number;
      incorrect: number;
      total: number;
      score: number;
      durationSeconds: number;
      startedAt: string;
      finishedAt: string;
    }
  | {
      status: "not-found";
    }
  | {
      status: "incomplete";
      categoryId: number;
    };

export type ErrorReviewResult =
  | {
      status: "ready";
      game: CompletedGameRef;
      categoryName: string;
      totalQuestions: number;
      correct: number;
      incorrect: number;
      score: number;
      durationSeconds: number;
      errors: ErrorReviewQuestion[];
    }
  | {
      status: "not-found";
    }
  | {
      status: "incomplete";
      categoryId: number;
    };

export type GameDetailResult =
  | {
      status: "ready";
      game: CompletedGameRef;
      categoryName: string;
      totalQuestions: number;
      correct: number;
      incorrect: number;
      score: number;
      durationSeconds: number;
      answers: GameDetailQuestion[];
    }
  | {
      status: "not-found";
    }
  | {
      status: "incomplete";
      categoryId: number;
    };

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function futureDate(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function parseStoredDate(value: string): Date {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const sqliteUtc = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(sqliteUtc.getTime()) ? new Date() : sqliteUtc;
}

function elapsedSeconds(startedAt: string, finishedAt: string): number {
  const started = parseStoredDate(startedAt);
  const finished = parseStoredDate(finishedAt);
  return Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000));
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function cleanupExpiredGames(): void {
  db.delete(gameSessions).where(lt(gameSessions.expiresAt, new Date().toISOString())).run();
}

function setGameCookie(cookies: CookieJar, request: Request, gameId: string): void {
  cookies.set(gameSessionCookie, gameId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(request),
    maxAge: gameHours * 60 * 60
  });
}

function clearGameCookie(cookies: CookieJar): void {
  cookies.delete(gameSessionCookie, { path: "/" });
}

function parseQuestionIds(game: GameSession): number[] {
  const parsed = JSON.parse(game.questionIds) as unknown;
  return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
}

function isCorrectOption(value: unknown): value is CorrectOption {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

function parseAnswers(game: GameSession): GameAnswer[] {
  const parsed = JSON.parse(game.answers) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((entry): entry is GameAnswer => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const answer = entry as Partial<GameAnswer>;
    return (
      Number.isInteger(answer.questionId) &&
      Number.isInteger(answer.order) &&
      isCorrectOption(answer.selectedOption) &&
      isCorrectOption(answer.correctOption) &&
      typeof answer.isCorrect === "boolean" &&
      typeof answer.answeredAt === "string"
    );
  });
}

function optionLabel(question: Question, option: CorrectOption): string {
  return {
    A: question.optionA,
    B: question.optionB,
    C: question.optionC,
    D: question.optionD
  }[option];
}

function completedGameRefFromAttempt(attempt: QuizAttempt): CompletedGameRef {
  return {
    id: attempt.id,
    categoryId: attempt.categoryId,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt
  };
}

function completedGameRefFromSession(game: GameSession): CompletedGameRef {
  return {
    id: game.id,
    categoryId: game.categoryId,
    startedAt: game.createdAt,
    finishedAt: game.updatedAt
  };
}

function answerDetailsFromGame(game: GameSession): GameDetailQuestion[] {
  const questionMap = new Map(getQuestionsByIds(parseQuestionIds(game)).map((question) => [question.id, question]));
  return parseAnswers(game)
    .sort((left, right) => left.order - right.order)
    .map((answer): GameDetailQuestion | undefined => {
      const question = questionMap.get(answer.questionId);
      if (!question) {
        return undefined;
      }

      return {
        order: answer.order,
        question,
        selectedOption: answer.selectedOption,
        selectedLabel: optionLabel(question, answer.selectedOption),
        correctOption: answer.correctOption,
        correctLabel: optionLabel(question, answer.correctOption),
        isCorrect: answer.isCorrect
      };
    })
    .filter((entry): entry is GameDetailQuestion => Boolean(entry));
}

function getStoredAttempt(attemptId: string, learnerId?: string): QuizAttempt | undefined {
  if (!learnerId) {
    return db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).get();
  }

  return db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.learnerId, learnerId)))
    .get();
}

function getStoredAttemptAnswers(attemptId: string): QuizAttemptAnswer[] {
  return db
    .select()
    .from(quizAttemptAnswers)
    .where(eq(quizAttemptAnswers.attemptId, attemptId))
    .all()
    .sort((left, right) => left.answerOrder - right.answerOrder);
}

function questionFromAttemptAnswer(answer: QuizAttemptAnswer, categoryId: number): Question {
  return {
    id: answer.questionId,
    categoryId,
    prompt: answer.questionPrompt,
    optionA: answer.optionA,
    optionB: answer.optionB,
    optionC: answer.optionC,
    optionD: answer.optionD,
    correctOption: answer.correctOption,
    imagePath: answer.questionImagePath,
    createdAt: answer.answeredAt,
    updatedAt: answer.answeredAt
  };
}

function answerDetailsFromAttempt(attempt: QuizAttempt): GameDetailQuestion[] {
  return getStoredAttemptAnswers(attempt.id).map((answer) => ({
    order: answer.answerOrder,
    question: questionFromAttemptAnswer(answer, attempt.categoryId),
    selectedOption: answer.selectedOption,
    selectedLabel: answer.selectedLabel,
    correctOption: answer.correctOption,
    correctLabel: answer.correctLabel,
    isCorrect: answer.isCorrect === 1
  }));
}

function answerDetailsForGameId(gameId: string, learnerId?: string): GameDetailQuestion[] {
  const attempt = getStoredAttempt(gameId, learnerId);
  if (attempt) {
    return answerDetailsFromAttempt(attempt);
  }

  const game = db.select().from(gameSessions).where(eq(gameSessions.id, gameId)).get();
  if (learnerId && game?.learnerId !== learnerId) {
    return [];
  }

  return game ? answerDetailsFromGame(game) : [];
}

function persistCompletedAttempt(game: GameSession): void {
  if (getStoredAttempt(game.id)) {
    return;
  }

  const category = getCategory(game.categoryId);
  const answers = answerDetailsFromGame(game);
  const ids = parseQuestionIds(game);
  const totalQuestions = answers.length || getQuestionsByIds(ids).length || ids.length || 1;
  const correctCount = game.correctCount;
  const incorrectCount = Math.max(totalQuestions - correctCount, 0);
  const score = Math.round((correctCount * 100) / totalQuestions);
  const startedAt = game.createdAt;
  const finishedAt = game.updatedAt;

  const writeAttempt = sqlite.transaction(() => {
    db.insert(quizAttempts)
      .values({
        id: game.id,
        learnerId: game.learnerId,
        categoryId: game.categoryId,
        categoryName: category?.name ?? "Categoria",
        totalQuestions,
        correctCount,
        incorrectCount,
        score,
        startedAt,
        finishedAt,
        durationSeconds: elapsedSeconds(startedAt, finishedAt)
      })
      .run();

    if (answers.length > 0) {
      db.insert(quizAttemptAnswers)
        .values(
          answers.map((answer) => ({
            attemptId: game.id,
            questionId: answer.question.id,
            questionPrompt: answer.question.prompt,
            questionImagePath: answer.question.imagePath,
            optionA: answer.question.optionA,
            optionB: answer.question.optionB,
            optionC: answer.question.optionC,
            optionD: answer.question.optionD,
            selectedOption: answer.selectedOption,
            selectedLabel: answer.selectedLabel,
            correctOption: answer.correctOption,
            correctLabel: answer.correctLabel,
            isCorrect: answer.isCorrect ? 1 : 0,
            answerOrder: answer.order,
            answeredAt: parseAnswers(game).find((entry) => entry.order === answer.order)?.answeredAt ?? finishedAt
          }))
        )
        .run();
    }
  });

  writeAttempt();
}

export function startOrResumeGame(
  cookies: CookieJar,
  request: Request,
  categoryId: number,
  requiredQuestions: number,
  learnerId?: string
): GameState {
  cleanupExpiredGames();

  const category = getCategory(categoryId);
  if (!category) {
    return { status: "missing-category" };
  }

  const existingId = cookies.get(gameSessionCookie)?.value;
  if (existingId) {
    const existing = db.select().from(gameSessions).where(eq(gameSessions.id, existingId)).get();
    if (existing && existing.categoryId === categoryId && existing.completed === 0 && (!learnerId || existing.learnerId === learnerId)) {
      const existingState = gameStateFromSession(existing, category.name);
      if (existingState.status === "ready") {
        return existingState;
      }

      db.delete(gameSessions).where(eq(gameSessions.id, existing.id)).run();
      clearGameCookie(cookies);
    }
  }

  const availableQuestions = getQuestionsForCategory(categoryId);
  if (availableQuestions.length < requiredQuestions) {
    return {
      status: "insufficient",
      categoryName: category.name,
      availableQuestions: availableQuestions.length,
      requiredQuestions
    };
  }

  const selectedQuestions = shuffle(availableQuestions).slice(0, requiredQuestions);
  const gameId = randomToken();
  db.insert(gameSessions)
    .values({
      id: gameId,
      learnerId: learnerId ?? null,
      categoryId,
      questionIds: JSON.stringify(selectedQuestions.map((question) => question.id)),
      answers: "[]",
      currentIndex: 0,
      currentToken: randomToken(16),
      correctCount: 0,
      completed: 0,
      expiresAt: futureDate(gameHours)
    })
    .run();

  setGameCookie(cookies, request, gameId);
  const game = db.select().from(gameSessions).where(eq(gameSessions.id, gameId)).get() as GameSession;
  return gameStateFromSession(game, category.name);
}

function gameStateFromSession(game: GameSession, categoryName: string): GameState {
  const questionIds = parseQuestionIds(game);
  const currentQuestionId = questionIds[game.currentIndex];
  const question = currentQuestionId ? findQuestionInCategory(currentQuestionId, game.categoryId) : undefined;
  if (!question) {
    return {
      status: "insufficient",
      categoryName,
      availableQuestions: 0,
      requiredQuestions: questionIds.length || 1
    };
  }

  return {
    status: "ready",
    game,
    categoryName,
    question,
    currentNumber: game.currentIndex + 1,
    totalQuestions: questionIds.length,
    answerToken: game.currentToken
  };
}

export function answerCurrentQuestion(
  cookies: CookieJar,
  categoryId: number,
  questionId: number,
  answerToken: string,
  answer: CorrectOption
): { status: "next"; game: GameSession } | { status: "completed"; game: GameSession } | { status: "invalid" } {
  const gameId = cookies.get(gameSessionCookie)?.value;
  if (!gameId) {
    return { status: "invalid" };
  }

  const game = db.select().from(gameSessions).where(eq(gameSessions.id, gameId)).get();
  if (!game || game.categoryId !== categoryId || game.completed === 1) {
    return { status: "invalid" };
  }

  const questionIds = parseQuestionIds(game);
  const currentQuestionId = questionIds[game.currentIndex];
  const currentQuestion = currentQuestionId ? findQuestionInCategory(currentQuestionId, categoryId) : undefined;
  if (!currentQuestion || currentQuestion.id !== questionId || game.currentToken !== answerToken) {
    return { status: "invalid" };
  }

  const isCorrect = currentQuestion.correctOption === answer;
  const nextIndex = game.currentIndex + 1;
  const completed = nextIndex >= questionIds.length;
  const correctCount = game.correctCount + (isCorrect ? 1 : 0);
  const nextToken = randomToken(16);
  const answers = [
    ...parseAnswers(game),
    {
      questionId,
      selectedOption: answer,
      correctOption: currentQuestion.correctOption,
      isCorrect,
      order: game.currentIndex + 1,
      answeredAt: new Date().toISOString()
    }
  ] satisfies GameAnswer[];

  const update = sqlite
    .prepare(
      `
      UPDATE game_sessions
      SET current_index = ?,
          current_token = ?,
          correct_count = ?,
          answers = ?,
          completed = ?,
          updated_at = ?
      WHERE id = ?
        AND category_id = ?
        AND current_index = ?
        AND current_token = ?
        AND completed = 0
    `
    )
    .run(
      completed ? game.currentIndex : nextIndex,
      nextToken,
      correctCount,
      JSON.stringify(answers),
      completed ? 1 : 0,
      new Date().toISOString(),
      game.id,
      categoryId,
      game.currentIndex,
      answerToken
    );

  if (update.changes !== 1) {
    return { status: "invalid" };
  }

  incrementAnswered();
  if (completed) {
    incrementCompleted();
  }

  const updated = db.select().from(gameSessions).where(eq(gameSessions.id, game.id)).get() as GameSession;
  if (completed) {
    persistCompletedAttempt(updated);
  }

  return { status: completed ? "completed" : "next", game: updated };
}

export function getGameResult(gameId: string | undefined, learnerId?: string): GameResult {
  if (!gameId) {
    return { status: "not-found" };
  }

  const attempt = getStoredAttempt(gameId, learnerId);
  if (attempt) {
    return {
      status: "ready",
      game: completedGameRefFromAttempt(attempt),
      categoryName: attempt.categoryName,
      correct: attempt.correctCount,
      incorrect: attempt.incorrectCount,
      total: attempt.totalQuestions,
      score: attempt.score,
      durationSeconds: attempt.durationSeconds,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt
    };
  }

  const game = db.select().from(gameSessions).where(eq(gameSessions.id, gameId)).get();
  if (!game) {
    return { status: "not-found" };
  }

  if (learnerId && game.learnerId !== learnerId) {
    return { status: "not-found" };
  }

  if (game.completed === 0) {
    return { status: "incomplete", categoryId: game.categoryId };
  }

  persistCompletedAttempt(game);
  const storedAttempt = getStoredAttempt(game.id, learnerId);
  if (storedAttempt) {
    return {
      status: "ready",
      game: completedGameRefFromAttempt(storedAttempt),
      categoryName: storedAttempt.categoryName,
      correct: storedAttempt.correctCount,
      incorrect: storedAttempt.incorrectCount,
      total: storedAttempt.totalQuestions,
      score: storedAttempt.score,
      durationSeconds: storedAttempt.durationSeconds,
      startedAt: storedAttempt.startedAt,
      finishedAt: storedAttempt.finishedAt
    };
  }

  const category = getCategory(game.categoryId);
  const ids = parseQuestionIds(game);
  const total = getQuestionsByIds(ids).length;
  const safeTotal = total || ids.length || 1;
  const correct = game.correctCount;
  const incorrect = Math.max(safeTotal - correct, 0);

  return {
    status: "ready",
    game: completedGameRefFromSession(game),
    categoryName: category?.name ?? "Categoria",
    correct,
    incorrect,
    total: safeTotal,
    score: Math.round((correct * 100) / safeTotal),
    durationSeconds: elapsedSeconds(game.createdAt, game.updatedAt),
    startedAt: game.createdAt,
    finishedAt: game.updatedAt
  };
}

export function getErrorReview(gameId: string | undefined, learnerId?: string): ErrorReviewResult {
  const result = getGameResult(gameId, learnerId);
  if (result.status !== "ready") {
    return result;
  }

  const errors = answerDetailsForGameId(result.game.id, learnerId).filter((answer) => !answer.isCorrect);

  return {
    status: "ready",
    game: result.game,
    categoryName: result.categoryName,
    totalQuestions: result.total,
    correct: result.correct,
    incorrect: result.incorrect,
    score: result.score,
    durationSeconds: result.durationSeconds,
    errors
  };
}

export function getGameDetails(gameId: string | undefined, learnerId?: string): GameDetailResult {
  const result = getGameResult(gameId, learnerId);
  if (result.status !== "ready") {
    return result;
  }

  return {
    status: "ready",
    game: result.game,
    categoryName: result.categoryName,
    totalQuestions: result.total,
    correct: result.correct,
    incorrect: result.incorrect,
    score: result.score,
    durationSeconds: result.durationSeconds,
    answers: answerDetailsForGameId(result.game.id, learnerId)
  };
}
