import { expect, test, type Page } from "@playwright/test";
import { createCategory, createQuestion, deleteCategoryAndImages, listCategories } from "../../src/lib/store";

async function loginAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Usuario").fill("admin");
  await page.getByLabel("Contrasena").fill("admin");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function acceptDeleteDialog(page: Page): Promise<void> {
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(/Eliminar/);
    await dialog.accept();
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function createWrongAnswerQuizCategory(): Promise<{ id: number; name: string }> {
  const suffix = Date.now().toString();
  const name = `Practica errores E2E ${suffix}`;
  const categoryId = createCategory(name);

  for (let index = 1; index <= 3; index += 1) {
    createQuestion({
      categoryId,
      prompt: `Pregunta con error esperado ${suffix}-${index}`,
      optionA: "Opcion incorrecta",
      optionB: "Opcion correcta",
      optionC: "Distractor C",
      optionD: "Distractor D",
      correctOption: "B"
    });
  }

  return { id: categoryId, name };
}

async function completeSeededQuiz(page: Page, categoryName = "Razonamiento demo"): Promise<void> {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Pon a prueba/i })).toBeVisible();
  await page.locator("article").filter({ hasText: categoryName }).getByRole("link", { name: "Iniciar" }).click();

  for (let step = 0; step < 3; step += 1) {
    await expect(page.getByText(new RegExp(`Pregunta ${step + 1} de 3`))).toBeVisible();
    await page.locator('input[name="answer"]').first().check();
    await page.getByRole("button", { name: "Siguiente" }).click();
  }

  await expect(page.getByRole("heading", { name: "Aqui tienes tu resultado" })).toBeVisible();
}

test("public user can complete a seeded quiz", async ({ page }) => {
  const category = await createWrongAnswerQuizCategory();

  try {
    await completeSeededQuiz(page, category.name);
    await expect(page.getByText("Tiempo empleado")).toBeVisible();
    await expect(page.getByText("45:31")).toHaveCount(0);
    await page.getByRole("link", { name: "Ver detalles" }).click();
    await expect(page.getByRole("heading", { name: "Detalle del simulacro" })).toBeVisible();
    await expect(page.getByTestId("result-detail-card")).toHaveCount(3);
    await page.getByRole("link", { name: "Volver al resultado" }).click();
    await expect(page.getByRole("heading", { name: "Aqui tienes tu resultado" })).toBeVisible();
    await page.getByRole("link", { name: "Repasar errores" }).click();
    await expect(page.getByRole("heading", { name: "Corrige lo que fallaste" })).toBeVisible();
    await expect(page.getByTestId("error-review-card").first()).toBeVisible();
  } finally {
    await deleteCategoryAndImages(category.id);
  }
});

test("public history is scoped to the current visitor", async ({ browser }) => {
  const category = await createWrongAnswerQuizCategory();
  const learnerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const learnerPage = await learnerContext.newPage();
  const otherPage = await otherContext.newPage();

  try {
    await completeSeededQuiz(learnerPage, category.name);
    await learnerPage.goto("/historial");
    await expect(learnerPage.getByRole("cell", { name: category.name })).toBeVisible();

    await otherPage.goto("/historial");
    await expect(otherPage.getByRole("heading", { name: "Aun no hay intentos" })).toBeVisible();
    await expect(otherPage.getByText(category.name)).toHaveCount(0);
  } finally {
    await learnerContext.close();
    await otherContext.close();
    await deleteCategoryAndImages(category.id);
  }
});

test("public mobile navigation is available across public pages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("region", { name: "Pulso actual del simulador" })).toBeVisible();
  await expect(page.getByText("Categorias listas")).toBeVisible();

  const mobileNav = page.getByRole("navigation", { name: "Navegacion publica movil" });
  await expect(mobileNav.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
  await mobileNav.getByRole("link", { name: "Categorias" }).click();
  await expect(page).toHaveURL(/\/categorias$/);

  const categoriesNav = page.getByRole("navigation", { name: "Navegacion publica movil" });
  await expect(categoriesNav.getByRole("link", { name: "Categorias" })).toHaveAttribute("aria-current", "page");
  await categoriesNav.getByRole("link", { name: "Simulacros" }).click();
  await expect(page).toHaveURL(/\/simulacros$/);
  await expect(page.getByRole("navigation", { name: "Navegacion publica movil" }).getByRole("link", { name: "Simulacros" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("navigation", { name: "Navegacion publica movil" }).getByRole("link", { name: "Historial" }).click();
  await expect(page).toHaveURL(/\/historial$/);
  await expect(page.getByRole("navigation", { name: "Navegacion publica movil" }).getByRole("link", { name: "Historial" })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
});

test("public user can open simulacros page and start a seeded simulation", async ({ page }) => {
  await page.goto("/simulacros");

  await expect(page.getByRole("heading", { name: "Simulacros", exact: true })).toBeVisible();
  await expect(page.getByText("Razonamiento demo")).toBeVisible();

  await page.locator("article").filter({ hasText: "Razonamiento demo" }).getByRole("link", { name: "Iniciar" }).click();
  await expect(page.getByText("Pregunta 1 de 3")).toBeVisible();
});

test("public user can open focused practice page from simulations", async ({ page }) => {
  await page.goto("/simulacros");

  const focusedPracticeCard = page.getByRole("link", { name: /Practica enfocada/ });
  await expect(focusedPracticeCard).toHaveAttribute("href", "/practica-enfocada");
  await focusedPracticeCard.click();
  await expect(page).toHaveURL(/\/practica-enfocada$/);
  await expect(page.getByRole("heading", { name: "Entrena una categoria hasta dominarla." })).toBeVisible();
});

test("public user can open constant rhythm page from simulations", async ({ page }) => {
  await page.goto("/simulacros");

  const rhythmCard = page.getByRole("link", { name: /Ritmo constante/ });
  await expect(rhythmCard).toHaveAttribute("href", "/ritmo-constante");
  await rhythmCard.click();
  await expect(page).toHaveURL(/\/ritmo-constante$/);
  await expect(page.getByRole("heading", { name: "Mantén sesiones cortas para repasar sin perder foco." })).toBeVisible();
});

test("public user can open learn page from home", async ({ page }) => {
  await page.goto("/");

  const learnCard = page.getByRole("link", { name: /Aprende/ });
  await expect(learnCard).toHaveAttribute("href", "/aprende");
  await learnCard.click();
  await expect(page).toHaveURL(/\/aprende$/);
  await expect(page.getByRole("heading", { name: "Refuerza tus conocimientos con preguntas clave." })).toBeVisible();
});

test("public user can open learn pillar pages", async ({ page }) => {
  const pillars = [
    {
      name: /Conceptos base/,
      href: "/conceptos-base",
      heading: "Empieza por categorias listas para construir seguridad antes de subir el ritmo."
    },
    {
      name: /Preguntas al azar/,
      href: "/preguntas-al-azar",
      heading: "Cada intento mezcla el banco disponible para evitar memorizar solo el orden."
    },
    {
      name: /Repaso dirigido/,
      href: "/repaso-dirigido",
      heading: "Los resultados te muestran donde volver para reforzar con mas precision."
    }
  ];

  for (const pillar of pillars) {
    await page.goto("/aprende");
    const pillarCard = page.getByRole("link", { name: pillar.name });
    await expect(pillarCard).toHaveAttribute("href", pillar.href);
    await pillarCard.click();
    await expect(page).toHaveURL(new RegExp(`${pillar.href}$`));
    await expect(page.getByRole("heading", { name: pillar.heading })).toBeVisible();
  }
});

test("public user can open limits page from home", async ({ page }) => {
  await page.goto("/");

  const limitsCard = page.getByRole("link", { name: /Supera tus limites/ });
  await expect(limitsCard).toHaveAttribute("href", "/supera-tus-limites");
  await limitsCard.click();
  await expect(page).toHaveURL(/\/supera-tus-limites$/);
  await expect(page.getByRole("heading", { name: "Cada practica te acerca a tu objetivo." })).toBeVisible();
});

test("admin routes require login and accept seeded credentials", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);

  await loginAdmin(page);
  await expect(page.getByRole("heading", { name: "Hola, administrador!" })).toBeVisible();
});

test("admin category and simulation modules use separate admin routes", async ({ page }) => {
  await loginAdmin(page);

  await page.goto("/admin/categorias");
  await expect(page.getByRole("heading", { name: "Categorias", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Simulacros" })).toHaveAttribute("href", "/admin/simulacros");

  await page.goto("/admin/simulacros");
  await expect(page.getByRole("heading", { name: "Simulacros", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Categorias" })).toHaveAttribute("href", "/admin/categorias");
});

test("admin mobile navigation exposes all modules", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAdmin(page);

  const mobileNav = page.getByRole("navigation", { name: "Navegacion administrativa movil" });
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Panel" })).toHaveAttribute("aria-current", "page");
  await expect(mobileNav.getByRole("link", { name: "Categorias" })).toBeVisible();

  await mobileNav.getByRole("link", { name: "Preguntas" }).click();
  await expect(page).toHaveURL(/\/admin\/preguntas$/);
  const questionsMobileNav = page.getByRole("navigation", { name: "Navegacion administrativa movil" });
  await expect(questionsMobileNav.getByRole("link", { name: "Preguntas" })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
});

test("admin can create, edit and delete a category", async ({ page }) => {
  const suffix = Date.now().toString();
  const name = `Categoria E2E ${suffix}`;
  const updatedName = `${name} editada`;

  await loginAdmin(page);
  await page.goto("/admin/categorias");

  await page.getByTestId("category-name").fill(name);
  await page.getByTestId("create-category").click();
  await expect(page.getByText("Categoria creada correctamente.")).toBeVisible();

  const createdCard = page.getByTestId("category-card").filter({ hasText: name });
  await expect(createdCard).toBeVisible();
  await createdCard.getByTestId("edit-category-name").fill(updatedName);
  await createdCard.getByTestId("update-category").click();
  await expect(page.getByText("Categoria actualizada correctamente.")).toBeVisible();

  const updatedCard = page.getByTestId("category-card").filter({ hasText: updatedName });
  await expect(updatedCard).toBeVisible();
  await acceptDeleteDialog(page);
  await updatedCard.getByTestId("delete-category").click();
  await expect(page.getByText("Categoria eliminada correctamente.")).toBeVisible();
  await expect(page.getByText(updatedName)).toHaveCount(0);
});

test("admin can create, edit and delete a question", async ({ page }) => {
  const suffix = Date.now().toString();
  const prompt = `Pregunta CRUD E2E ${suffix}`;
  const updatedPrompt = `${prompt} actualizada`;

  await loginAdmin(page);
  await page.goto("/admin/preguntas/nueva");

  await page.getByTestId("question-category").selectOption({ label: "Razonamiento demo" });
  await page.getByTestId("question-prompt").fill(prompt);
  await page.getByTestId("question-option-A").fill("Respuesta A");
  await page.getByTestId("question-option-B").fill("Respuesta B");
  await page.getByTestId("question-option-C").fill("Respuesta C");
  await page.getByTestId("question-option-D").fill("Respuesta D");
  await page.getByTestId("question-correct-option").selectOption("B");
  await page.getByTestId("save-question").click();
  await expect(page.getByText("Pregunta creada correctamente.")).toBeVisible();

  await page.goto("/admin/preguntas");
  const createdCard = page.getByTestId("question-card").filter({ hasText: prompt });
  await expect(createdCard).toBeVisible();

  await createdCard.getByTestId("edit-question").click();
  await expect(page.getByRole("heading", { name: "Editar pregunta" })).toBeVisible();
  await page.getByTestId("edit-question-prompt").fill(updatedPrompt);
  await page.getByTestId("update-question").click();
  await expect(page).toHaveURL(/\/admin\/preguntas$/);

  const updatedCard = page.getByTestId("question-card").filter({ hasText: updatedPrompt });
  await expect(updatedCard).toBeVisible();
  await acceptDeleteDialog(page);
  await updatedCard.getByTestId("delete-question").click();
  await expect(page).toHaveURL(/\/admin\/preguntas$/);
  await expect(page.getByText(updatedPrompt)).toHaveCount(0);
});

test("admin question filters search real rows", async ({ page }) => {
  const suffix = Date.now().toString();
  const prompt = `Pregunta filtro E2E ${suffix}`;

  await loginAdmin(page);
  await page.goto("/admin/preguntas/nueva");
  await page.getByTestId("question-category").selectOption({ label: "Razonamiento demo" });
  await page.getByTestId("question-prompt").fill(prompt);
  await page.getByTestId("question-option-A").fill("Respuesta A filtro");
  await page.getByTestId("question-option-B").fill("Respuesta B filtro");
  await page.getByTestId("question-option-C").fill("Respuesta C filtro");
  await page.getByTestId("question-option-D").fill("Respuesta D filtro");
  await page.getByTestId("question-correct-option").selectOption("A");
  await page.getByTestId("save-question").click();

  await page.goto(`/admin/preguntas?buscar=${encodeURIComponent(prompt)}`);
  await expect(page.getByTestId("question-card").filter({ hasText: prompt })).toBeVisible();

  await page.getByTestId("question-category-filter").selectOption({ label: "Razonamiento demo" });
  await page.getByTestId("question-search").fill("no existe filtro e2e");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("No hay preguntas que coincidan con los filtros.")).toBeVisible();
});

test("admin can import questions from CSV", async ({ page }) => {
  const suffix = Date.now().toString();
  const categoryName = `Importacion E2E ${suffix}`;
  const prompt = `Pregunta importada desde CSV ${suffix}`;
  const csv = [
    "categoria,pregunta,opcion_a,opcion_b,opcion_c,opcion_d,respuesta_correcta",
    `${categoryName},${prompt},Respuesta A,Respuesta B,Respuesta C,Respuesta D,B`
  ].join("\n");

  try {
    await loginAdmin(page);
    await page.goto("/admin/importar");

    await page.getByTestId("import-csv-file").setInputFiles({
      name: "preguntas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8")
    });
    await page.getByTestId("import-csv-submit").click();

    await expect(page.getByText(/Importacion lista: 1 preguntas creadas/)).toBeVisible();

    await page.goto(`/admin/preguntas?buscar=${encodeURIComponent(prompt)}`);
    await expect(page.getByTestId("question-card").filter({ hasText: prompt })).toBeVisible();
  } finally {
    const importedCategory = listCategories().find((category) => category.name === categoryName);
    if (importedCategory) {
      await deleteCategoryAndImages(importedCategory.id);
    }
  }
});

test("admin reports show persisted quiz attempts", async ({ page }) => {
  await completeSeededQuiz(page);
  await loginAdmin(page);
  await page.goto("/admin/reportes");

  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  await expect(page.getByText("Intentos", { exact: true })).toBeVisible();
  await expect(page.getByText("Precision media", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ultimos intentos" })).toBeVisible();
  await expect(page.getByText("Razonamiento demo").first()).toBeVisible();

  const csvResponse = await page.request.get("/admin/reportes.csv");
  expect(csvResponse.status()).toBe(200);
  await expect(csvResponse).toBeOK();
  expect(await csvResponse.text()).toContain("categoria");
});
