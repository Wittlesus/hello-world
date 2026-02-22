/**
 * Placeholder for views that will be built in future steps.
 * Each view will get its own component when the data layer is wired.
 */
export function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <h2 className="text-lg font-semibold text-gray-300">{title}</h2>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
    </div>
  );
}
