import { it } from "vitest";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { analyzeFullShow } from "@/lib/show/fullshow";
it("dbg", () => {
  const { report } = analyzeFullShow(createDefaultProject(), { sampleRate: 10 });
  console.log(report.status, report.statement);
  console.log(report.errors.slice(0, 8).map((e) => [e.code, e.message]));
  console.log(report.warnings.slice(0, 5).map((e) => [e.code, e.message]));
});
