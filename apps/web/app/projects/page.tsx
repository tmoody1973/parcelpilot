import { ProjectsList } from "./projects-list.tsx";

export const metadata = { title: "Projects · ParcelPilot" };

export default function ProjectsPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-ink">Projects</h1>
      <p className="mb-4 text-sm text-muted">Every development idea you have saved, newest first.</p>
      <ProjectsList />
    </main>
  );
}
