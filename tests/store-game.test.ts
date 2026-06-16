import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CookieJar } from "../src/lib/cookies";
import type { CorrectOption } from "../src/db/schema";

type StoreModule = typeof import("../src/lib/store");
type GameModule = typeof import("../src/lib/game");
type DbClientModule = typeof import("../src/db/client");
type AuthModule = typeof import("../src/lib/auth");

const tempDir = mkdtempSync(join(tmpdir(), "eus-sim-"));
let client: DbClientModule;
let store: StoreModule;
let game: GameModule;
let auth: AuthModule;

function createCookieJar(): CookieJar {
  const values = new Map<string, string>();
  return {
    get(name) {
      const value = values.get(name);
      return value ? { value } : undefined;
    },
    set(name, value) {
      values.set(name, value);
    },
    delete(name) {
      values.delete(name);
    }
  };
}

function wrongAnswer(correctOption: CorrectOption): CorrectOption {
  return correctOption === "A" ? "B" : "A";
}

beforeAll(async () => {
  process.env.DATABASE_URL = join(tempDir, "test.db");
  client = await import("../src/db/client");
  store = await import("../src/lib/store");
  game = await import("../src/lib/game");
  auth = await import("../src/lib/auth");
});

afterAll(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("store and game flow", () => {
  it("creates default settings with a hashed admin password", () => {
    const settings = store.ensureDefaultSettings();

    expect(settings.adminUsername).toBe("admin");
    expect(settings.adminPasswordHash).toContain("scrypt$");
    expect(settings.questionsPerGame).toBe(3);
  });

  it("blocks games when the category does not have enough questions", () => {
    const categoryId = store.createCategory("Categoria incompleta");
    const state = game.startOrResumeGame(createCookieJar(), new Request("http://localhost/"), categoryId, 3);

    expect(state.status).toBe("insufficient");
  });

  it("updates and deletes categories with their questions", async () => {
    const categoryId = store.createCategory("Categoria CRUD unit");
    const duplicateId = store.createCategory("Categoria duplicada unit");
    store.createQuestion({
      categoryId,
      prompt: "Pregunta para validar eliminacion por categoria",
      optionA: "A",
      optionB: "B",
      optionC: "C",
      optionD: "D",
      correctOption: "A"
    });

    expect(store.updateCategory(categoryId, "Categoria CRUD unit editada")).toBe("updated");
    expect(store.getCategory(categoryId)?.name).toBe("Categoria CRUD unit editada");
    expect(store.updateCategory(categoryId, "Categoria duplicada unit")).toBe("duplicate");
    expect(store.updateCategory(999_999, "Categoria perdida")).toBe("not-found");

    expect(store.getCategory(duplicateId)).toBeDefined();
    expect(await store.deleteCategoryAndImages(categoryId)).toBe("deleted");
    expect(store.getCategory(categoryId)).toBeUndefined();
    expect(store.getQuestionsForCategory(categoryId)).toHaveLength(0);
    expect(await store.deleteCategoryAndImages(categoryId)).toBe("not-found");
  });

  it("rate limits repeated failed admin login attempts", () => {
    const previousTrustProxy = process.env.TRUST_PROXY;
    const request = new Request("http://localhost/admin/login", {
      headers: { "x-forwarded-for": "203.0.113.10" }
    });

    try {
      delete process.env.TRUST_PROXY;
      expect(auth.loginIdentifier(request, "admin")).toBe("local:admin");

      process.env.TRUST_PROXY = "true";
      const identifier = auth.loginIdentifier(request, "admin");
      expect(identifier).toBe("203.0.113.10:admin");

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(auth.isLoginRateLimited(identifier)).toBe(false);
        auth.recordFailedLogin(identifier);
      }

      expect(auth.isLoginRateLimited(identifier)).toBe(true);
      auth.clearLoginAttempts(identifier);
      expect(auth.isLoginRateLimited(identifier)).toBe(false);
    } finally {
      auth.clearLoginAttempts("local:admin");
      auth.clearLoginAttempts("203.0.113.10:admin");
      if (previousTrustProxy === undefined) {
        delete process.env.TRUST_PROXY;
      } else {
        process.env.TRUST_PROXY = previousTrustProxy;
      }
    }
  });

  it("keeps the current admin session and removes older sessions when credentials change", () => {
    store.ensureDefaultSettings();
    const currentCookies = createCookieJar();
    const oldCookies = createCookieJar();
    const request = new Request("http://localhost/admin/configuracion");

    const currentSession = auth.createAdminSession(currentCookies, request);
    const oldSession = auth.createAdminSession(oldCookies, request);

    store.updateSettings({
      adminUsername: "admin-updated",
      password: "password-seguro",
      questionsPerGame: 3,
      preserveSessionId: currentSession.id
    });

    expect(auth.getAdminSession(currentCookies)?.id).toBe(currentSession.id);
    expect(auth.getAdminSession(oldCookies)).toBeUndefined();
    expect(oldSession.id).not.toBe(currentSession.id);
  });

  it("runs a complete game and calculates the final result", () => {
    const categoryId = store.createCategory("Categoria jugable");
    const questionIds = [
      store.createQuestion({
        categoryId,
        prompt: "Pregunta numero uno para probar el flujo completo",
        optionA: "A1",
        optionB: "B1",
        optionC: "C1",
        optionD: "D1",
        correctOption: "A"
      }),
      store.createQuestion({
        categoryId,
        prompt: "Pregunta numero dos para probar el flujo completo",
        optionA: "A2",
        optionB: "B2",
        optionC: "C2",
        optionD: "D2",
        correctOption: "B"
      }),
      store.createQuestion({
        categoryId,
        prompt: "Pregunta numero tres para probar el flujo completo",
        optionA: "A3",
        optionB: "B3",
        optionC: "C3",
        optionD: "D3",
        correctOption: "C"
      })
    ];

    expect(questionIds).toHaveLength(3);

    const cookies = createCookieJar();
    const request = new Request("http://localhost/");
    let state = game.startOrResumeGame(cookies, request, categoryId, 3);
    expect(state.status).toBe("ready");

    let lastGameId = "";
    while (state.status === "ready") {
      lastGameId = state.game.id;
      const answer = state.question.correctOption as CorrectOption;
      const outcome = game.answerCurrentQuestion(cookies, categoryId, state.question.id, state.answerToken, answer);
      if (outcome.status === "completed") {
        lastGameId = outcome.game.id;
        break;
      }
      state = game.startOrResumeGame(cookies, request, categoryId, 3);
    }

    const result = game.getGameResult(lastGameId);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.correct).toBe(3);
      expect(result.incorrect).toBe(0);
      expect(result.score).toBe(100);
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
    }

    const persistedAttempt = client.sqlite
      .prepare("SELECT category_name AS categoryName, total_questions AS totalQuestions, correct_count AS correctCount, score, duration_seconds AS durationSeconds FROM quiz_attempts WHERE id = ?")
      .get(lastGameId) as { categoryName: string; totalQuestions: number; correctCount: number; score: number; durationSeconds: number } | undefined;
    expect(persistedAttempt).toMatchObject({
      categoryName: "Categoria jugable",
      totalQuestions: 3,
      correctCount: 3,
      score: 100
    });
    expect(persistedAttempt?.durationSeconds).toBeGreaterThanOrEqual(0);

    const persistedAnswers = client.sqlite
      .prepare("SELECT COUNT(*) AS count FROM quiz_attempt_answers WHERE attempt_id = ?")
      .get(lastGameId) as { count: number };
    expect(persistedAnswers.count).toBe(3);

    const report = store.getQuizReportSummary();
    expect(report.totalAttempts).toBeGreaterThanOrEqual(1);
    expect(report.totalAnswered).toBeGreaterThanOrEqual(3);
    expect(report.totalCorrect).toBeGreaterThanOrEqual(3);
  });

  it("filters public quiz history by learner id", () => {
    const suffix = Date.now().toString();
    const categoryId = store.createCategory(`Categoria aislada ${suffix}`);
    for (let index = 1; index <= 3; index += 1) {
      store.createQuestion({
        categoryId,
        prompt: `Pregunta aislada ${suffix}-${index}`,
        optionA: "A",
        optionB: "B",
        optionC: "C",
        optionD: "D",
        correctOption: "A"
      });
    }

    const request = new Request("http://localhost/");
    const completeForLearner = (learnerId: string): string => {
      const cookies = createCookieJar();
      let state = game.startOrResumeGame(cookies, request, categoryId, 3, learnerId);
      expect(state.status).toBe("ready");

      let lastGameId = "";
      while (state.status === "ready") {
        lastGameId = state.game.id;
        const outcome = game.answerCurrentQuestion(cookies, categoryId, state.question.id, state.answerToken, "A");
        if (outcome.status === "completed") {
          return outcome.game.id;
        }
        state = game.startOrResumeGame(cookies, request, categoryId, 3, learnerId);
      }

      return lastGameId;
    };

    const learnerA = `learner-a-${suffix}`;
    const learnerB = `learner-b-${suffix}`;
    const gameA = completeForLearner(learnerA);
    const gameB = completeForLearner(learnerB);

    expect(store.getQuizReportSummary(learnerA).totalAttempts).toBe(1);
    expect(store.getQuizReportSummary(learnerB).totalAttempts).toBe(1);
    expect(store.getQuizReportSummary(`learner-c-${suffix}`).totalAttempts).toBe(0);
    expect(store.listRecentQuizAttempts(10, learnerA).map((attempt) => attempt.id)).toEqual([gameA]);
    expect(store.listRecentQuizAttempts(10, learnerB).map((attempt) => attempt.id)).toEqual([gameB]);
    expect(game.getGameResult(gameB, learnerA).status).toBe("not-found");
    expect(game.getGameDetails(gameA, learnerA).status).toBe("ready");
  });

  it("requires an explicit decision before replacing an active category game", () => {
    const suffix = Date.now().toString();
    const firstCategoryId = store.createCategory(`Partida activa A ${suffix}`);
    const secondCategoryId = store.createCategory(`Partida activa B ${suffix}`);

    for (let index = 1; index <= 3; index += 1) {
      store.createQuestion({
        categoryId: firstCategoryId,
        prompt: `Pregunta activa A ${suffix}-${index}`,
        optionA: "A",
        optionB: "B",
        optionC: "C",
        optionD: "D",
        correctOption: "A"
      });
      store.createQuestion({
        categoryId: secondCategoryId,
        prompt: `Pregunta activa B ${suffix}-${index}`,
        optionA: "A",
        optionB: "B",
        optionC: "C",
        optionD: "D",
        correctOption: "A"
      });
    }

    const cookies = createCookieJar();
    const request = new Request("http://localhost/");
    const learnerId = `learner-active-${suffix}`;
    const firstState = game.startOrResumeGame(cookies, request, firstCategoryId, 3, learnerId);
    expect(firstState.status).toBe("ready");
    if (firstState.status !== "ready") {
      return;
    }

    const conflict = game.startOrResumeGame(cookies, request, secondCategoryId, 3, learnerId);
    expect(conflict.status).toBe("active-conflict");
    if (conflict.status !== "active-conflict") {
      return;
    }
    expect(conflict.active.id).toBe(firstState.game.id);
    expect(conflict.active.categoryId).toBe(firstCategoryId);

    const resumed = game.startOrResumeGame(cookies, request, firstCategoryId, 3, learnerId);
    expect(resumed.status).toBe("ready");
    if (resumed.status === "ready") {
      expect(resumed.game.id).toBe(firstState.game.id);
    }

    expect(game.discardCurrentGame(cookies, learnerId)).toBe("discarded");
    const secondState = game.startOrResumeGame(cookies, request, secondCategoryId, 3, learnerId);
    expect(secondState.status).toBe("ready");
    if (secondState.status === "ready") {
      expect(secondState.game.categoryId).toBe(secondCategoryId);
      expect(secondState.game.id).not.toBe(firstState.game.id);
    }
  });

  it("stores wrong answers for error review", () => {
    const categoryId = store.createCategory("Categoria repaso errores");
    for (const [index, correctOption] of ["A", "B", "C"].entries()) {
      store.createQuestion({
        categoryId,
        prompt: `Pregunta para repasar error ${index}`,
        optionA: "Opcion A",
        optionB: "Opcion B",
        optionC: "Opcion C",
        optionD: "Opcion D",
        correctOption: correctOption as CorrectOption
      });
    }

    const cookies = createCookieJar();
    const request = new Request("http://localhost/");
    let state = game.startOrResumeGame(cookies, request, categoryId, 3);
    expect(state.status).toBe("ready");

    let lastGameId = "";
    while (state.status === "ready") {
      lastGameId = state.game.id;
      const answer = wrongAnswer(state.question.correctOption as CorrectOption);
      const outcome = game.answerCurrentQuestion(cookies, categoryId, state.question.id, state.answerToken, answer);
      if (outcome.status === "completed") {
        lastGameId = outcome.game.id;
        break;
      }
      state = game.startOrResumeGame(cookies, request, categoryId, 3);
    }

    const review = game.getErrorReview(lastGameId);
    expect(review.status).toBe("ready");
    if (review.status === "ready") {
      expect(review.errors).toHaveLength(3);
      expect(review.incorrect).toBe(3);
      expect(review.errors[0]?.selectedOption).not.toBe(review.errors[0]?.correctOption);
      expect(review.errors[0]?.selectedLabel).toMatch(/Opcion/);
      expect(review.errors[0]?.correctLabel).toMatch(/Opcion/);
    }

    const detail = game.getGameDetails(lastGameId);
    expect(detail.status).toBe("ready");
    if (detail.status === "ready") {
      expect(detail.answers).toHaveLength(3);
      expect(detail.answers.every((answer) => !answer.isCorrect)).toBe(true);
      expect(detail.answers[0]?.selectedLabel).toMatch(/Opcion/);
      expect(detail.answers[0]?.correctLabel).toMatch(/Opcion/);
    }
  });

  it("rejects stale answer tokens so a double submit cannot advance twice", () => {
    const categoryId = store.createCategory("Categoria doble submit");
    for (const [index, correctOption] of ["A", "B", "C"].entries()) {
      store.createQuestion({
        categoryId,
        prompt: `Pregunta unica doble submit ${index}`,
        optionA: "A",
        optionB: "B",
        optionC: "C",
        optionD: "D",
        correctOption: correctOption as CorrectOption
      });
    }

    const cookies = createCookieJar();
    const request = new Request("http://localhost/");
    const state = game.startOrResumeGame(cookies, request, categoryId, 3);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") {
      return;
    }

    const first = game.answerCurrentQuestion(
      cookies,
      categoryId,
      state.question.id,
      state.answerToken,
      state.question.correctOption as CorrectOption
    );
    const duplicate = game.answerCurrentQuestion(
      cookies,
      categoryId,
      state.question.id,
      state.answerToken,
      state.question.correctOption as CorrectOption
    );

    expect(first.status).toBe("next");
    expect(duplicate.status).toBe("invalid");
  });

  it("drops an invalid in-progress game when its current question was deleted", () => {
    const categoryId = store.createCategory("Categoria sesion invalida");
    for (const [index, correctOption] of ["A", "B", "C", "D"].entries()) {
      store.createQuestion({
        categoryId,
        prompt: `Pregunta recuperable por eliminacion ${index}`,
        optionA: "A",
        optionB: "B",
        optionC: "C",
        optionD: "D",
        correctOption: correctOption as CorrectOption
      });
    }

    const cookies = createCookieJar();
    const request = new Request("http://localhost/");
    const state = game.startOrResumeGame(cookies, request, categoryId, 3);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") {
      return;
    }

    const oldGameId = state.game.id;
    store.deleteQuestion(state.question.id);

    const recovered = game.startOrResumeGame(cookies, request, categoryId, 3);
    expect(recovered.status).toBe("ready");
    if (recovered.status === "ready") {
      expect(recovered.game.id).not.toBe(oldGameId);
      expect(recovered.question.id).not.toBe(state.question.id);
    }
  });

  it("filters admin questions by category and search text", () => {
    const mathCategoryId = store.createCategory("Filtro Matematica unit");
    const readingCategoryId = store.createCategory("Filtro Lectura unit");
    const uniquePrompt = "Pregunta filtrable algebra lineal";

    store.createQuestion({
      categoryId: mathCategoryId,
      prompt: uniquePrompt,
      optionA: "Vector",
      optionB: "Matriz",
      optionC: "Texto",
      optionD: "Grafico",
      correctOption: "B"
    });
    store.createQuestion({
      categoryId: readingCategoryId,
      prompt: "Pregunta filtrable comprension verbal",
      optionA: "Idea central",
      optionB: "Detalle",
      optionC: "Inferencia",
      optionD: "Resumen",
      correctOption: "A"
    });

    const bySearch = store.listQuestions({ search: "algebra lineal" });
    expect(bySearch).toHaveLength(1);
    expect(bySearch[0]?.prompt).toBe(uniquePrompt);

    const byCategory = store.listQuestions({ categoryId: readingCategoryId, search: "filtrable" });
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0]?.categoryName).toBe("Filtro Lectura unit");
  });

  it("detects duplicate question prompts with normalized text", () => {
    const categoryId = store.createCategory("Duplicados normalizados unit");
    const questionId = store.createQuestion({
      categoryId,
      prompt: "Pregunta   duplicada   normalizada",
      optionA: "A",
      optionB: "B",
      optionC: "C",
      optionD: "D",
      correctOption: "A"
    });

    expect(store.findQuestionByCategoryAndPrompt(categoryId, " pregunta duplicada NORMALIZADA ")?.id).toBe(questionId);
    expect(store.findQuestionByCategoryAndPrompt(categoryId, "pregunta duplicada normalizada", questionId)).toBeUndefined();
  });

  it("imports parsed question rows and skips existing duplicates", async () => {
    const { parseQuestionCsv } = await import("../src/lib/questionImport");
    const csv = [
      "categoria,pregunta,opcion_a,opcion_b,opcion_c,opcion_d,respuesta_correcta",
      "Importacion unit,Pregunta importada para validar guardado,Alternativa A,Alternativa B,Alternativa C,Alternativa D,D"
    ].join("\n");
    const parsed = parseQuestionCsv(csv);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const firstSummary = store.importQuestionRows(parsed.rows);
    expect(firstSummary).toEqual({
      createdQuestions: 1,
      skippedDuplicates: 0,
      createdCategories: 1
    });

    const secondSummary = store.importQuestionRows(parsed.rows);
    expect(secondSummary).toEqual({
      createdQuestions: 0,
      skippedDuplicates: 1,
      createdCategories: 0
    });

    const imported = store.listQuestions({ search: "Pregunta importada para validar guardado" });
    expect(imported).toHaveLength(1);
    expect(imported[0]?.categoryName).toBe("Importacion unit");
  });
});
