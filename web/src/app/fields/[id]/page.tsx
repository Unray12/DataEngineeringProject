type FieldPageProps = { params: Promise<{ id: string }> };

export default async function FieldDetailPage({ params }: FieldPageProps) {
  const { id } = await params;
  return <main><h1>Field detail: {id} — owner M1 — BR1 — not implemented yet</h1></main>;
}
