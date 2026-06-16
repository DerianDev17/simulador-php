import type { APIRoute } from "astro";
import { getAdminSession } from "@/lib/auth";
import { listRecentQuizAttempts } from "@/lib/store";

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const GET: APIRoute = ({ cookies }) => {
  const session = getAdminSession(cookies);
  if (!session) {
    return new Response("No autorizado.", { status: 401 });
  }

  const rows = listRecentQuizAttempts(10_000);
  const header = [
    "id",
    "categoria",
    "total_preguntas",
    "correctas",
    "incorrectas",
    "puntaje",
    "duracion_segundos",
    "fecha_fin"
  ];
  const body = [
    header.join(","),
    ...rows.map((attempt) =>
      [
        attempt.id,
        attempt.categoryName,
        attempt.totalQuestions,
        attempt.correctCount,
        attempt.incorrectCount,
        attempt.score,
        attempt.durationSeconds,
        attempt.finishedAt
      ]
        .map(csvCell)
        .join(",")
    )
  ].join("\n");

  return new Response(`${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="reportes-semilla-digital.csv"',
      "Cache-Control": "no-store"
    }
  });
};
