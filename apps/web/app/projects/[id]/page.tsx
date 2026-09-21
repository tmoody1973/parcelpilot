import { ProjectDetail } from "./project-detail.tsx";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-5xl p-6">
      <ProjectDetail projectId={id} />
    </main>
  );
}
