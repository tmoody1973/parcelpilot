import { TaskView } from "./task-view.tsx";

export default async function ReviewTaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <TaskView taskId={taskId} />
    </main>
  );
}
